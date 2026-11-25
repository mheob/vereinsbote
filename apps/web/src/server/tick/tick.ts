import { and, eq, sql } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { systemState } from '@/server/db/schema';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';
import type { ObjectStorage } from '@/server/storage/storage';
import { getState, setState } from '@/server/system-state';

/**
 * What a step gets: the database, the environment, the clock, the end of its time budget and the
 * object storage (attachments of the outbox).
 */
interface TickContext {
	readonly db: Db;
	readonly env: Env;
	readonly now: () => Date;
	/** Epoch milliseconds. A step stops starting new work at this point and reports `moreWork`. */
	readonly deadline: number;
	/** The storage the caller opened as for a request; null when none is set up. */
	readonly storage: ObjectStorage | null;
}

/** One unit of scheduled work. Later plans add steps to `tickSteps`. */
interface TickStep {
	readonly name: string;
	/** Does work until done or until `ctx.deadline`; `moreWork` asks for an early follow-up tick. */
	readonly run: (ctx: TickContext) => Promise<{ moreWork: boolean }>;
}

interface TickStepResult {
	readonly name: string;
	readonly outcome: 'done' | 'error' | 'skipped';
	/** The first line of the message of the error a step threw. */
	readonly error?: string;
}

interface CompletedTick {
	readonly status: 'completed';
	/** ISO 8601. */
	readonly startedAt: string;
	/** ISO 8601. */
	readonly finishedAt: string;
	readonly steps: readonly TickStepResult[];
	readonly moreWork: boolean;
}

type TickReport = CompletedTick | { readonly status: 'locked' };

interface RunTickDeps {
	db: Db;
	env: Env;
	/** The object storage, opened by the caller as for a request; null when none is set up. */
	storage: ObjectStorage | null;
	steps: readonly TickStep[];
	/** Time budget of the steps; tests shorten it. Default `TICK_BUDGET_MS`. */
	budgetMs?: number;
	now?: () => Date;
	/** Identifies this run in the lock. Default: a random UUID. */
	holderId?: string;
	fetchFn?: typeof fetch;
}

/** 4 minutes, so a tick ends well within a 5-minute function limit (Vercel's default duration). */
const TICK_BUDGET_MS = 240_000;
/** The lock outlives the budget by this much, so a crashed run frees it soon after. */
const LOCK_GRACE_MS = 60_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const MS_PER_SECOND = 1000;
/** Characters of a step's error message kept in the report. */
const MAX_ERROR_LENGTH = 300;

const defaultFetch: typeof fetch = async (input, init) => fetch(input, init);

/**
 * Takes the tick lock unless an unexpired one exists. One atomic statement on the database
 * clock, so it holds across isolates; no transaction stays open while the steps run.
 *
 * @param db The database.
 * @param holderId Identifies the run that takes the lock.
 * @param leaseMs How long the lock holds without a release.
 * @returns True when this run holds the lock now.
 */
async function acquireLock(db: Db, holderId: string, leaseMs: number): Promise<boolean> {
	const value = sql`jsonb_build_object(
		'holderId', ${holderId}::text,
		'expiresAt', now() + make_interval(secs => ${leaseMs / MS_PER_SECOND})
	)`;
	const acquired = await db
		.insert(systemState)
		.values({ key: 'tick_lock', updatedAt: sql`now()`, value })
		.onConflictDoUpdate({
			set: { updatedAt: sql`excluded.updated_at`, value: sql`excluded.value` },
			// A lock row without a readable expiry counts as expired, so it can never block forever.
			setWhere: sql`coalesce((${systemState.value}->>'expiresAt')::timestamptz, '-infinity') < now()`,
			target: systemState.key,
		})
		.returning({ key: systemState.key });
	return acquired.length > 0;
}

/**
 * Releases the tick lock if this run still holds it; a run whose lock expired and was taken
 * over leaves the new holder's lock alone. A failed release is only logged: the lock expires.
 *
 * @param db The database.
 * @param holderId The holder that took the lock.
 */
async function releaseLock(db: Db, holderId: string): Promise<void> {
	try {
		await db
			.delete(systemState)
			.where(
				and(eq(systemState.key, 'tick_lock'), sql`${systemState.value}->>'holderId' = ${holderId}`),
			);
	} catch (error) {
		// oxlint-disable-next-line no-console -- the lock expires on its own, the log explains the wait
		console.error('tick lock release failed', errorLabel(error));
	}
}

/**
 * The message of a step's error for the report: its first line only, shortened. Database errors
 * list the query parameters on later lines, and those may hold personal data.
 *
 * @param error Whatever the step threw.
 * @returns The message for the report.
 */
function reportedMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : 'unknown error';
	const [firstLine = ''] = message.split('\n', 1);
	return firstLine.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Runs one step, unless the deadline has passed. A thrown error becomes the step's outcome.
 *
 * @param step The step.
 * @param ctx What the step gets.
 * @returns The step's outcome and whether it left work (a skipped step always does).
 */
async function runStep(
	step: TickStep,
	ctx: TickContext,
): Promise<{ result: TickStepResult; moreWork: boolean }> {
	const { name } = step;
	if (ctx.now().getTime() >= ctx.deadline) {
		return { moreWork: true, result: { name, outcome: 'skipped' } };
	}
	try {
		const { moreWork } = await step.run(ctx);
		return { moreWork, result: { name, outcome: 'done' } };
	} catch (error) {
		// oxlint-disable-next-line no-console -- name or code only, the message may carry details
		console.error('tick step failed', name, errorLabel(error));
		return { moreWork: false, result: { error: reportedMessage(error), name, outcome: 'error' } };
	}
}

/**
 * Runs the steps one after another. A failing step does not stop the following ones; the tick
 * reports more work when any step does.
 *
 * @param steps The steps.
 * @param ctx What every step gets.
 * @returns The outcome of each step and whether work is left.
 */
async function runSteps(
	steps: readonly TickStep[],
	ctx: TickContext,
): Promise<Pick<CompletedTick, 'moreWork' | 'steps'>> {
	const results: TickStepResult[] = [];
	let moreWork = false;
	for (const step of steps) {
		// oxlint-disable-next-line no-await-in-loop -- steps run one after another by design
		const outcome = await runStep(step, ctx);
		results.push(outcome.result);
		moreWork ||= outcome.moreWork;
	}
	return { moreWork, steps: results };
}

/**
 * Pings the heartbeat URL, if one is set. A failure is only logged, without the URL.
 *
 * @param url The heartbeat URL, or null.
 * @param fetchFn The fetch implementation.
 */
async function pingHeartbeat(url: string | null, fetchFn: typeof fetch): Promise<void> {
	if (url === null) return;
	try {
		const response = await fetchFn(url, { signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
		await response.body?.cancel();
		if (!response.ok) {
			// oxlint-disable-next-line no-console -- the monitor will report the missing ping as well
			console.error('tick heartbeat failed', `HTTP ${response.status}`);
		}
	} catch (error) {
		// oxlint-disable-next-line no-console -- the monitor will report the missing ping as well
		console.error('tick heartbeat failed', errorLabel(error));
	}
}

/**
 * Runs the steps within the budget and stores the report under `last_tick`.
 *
 * @param deps The database, the environment, the steps and the clock.
 * @param budgetMs The time budget of the steps.
 * @returns The report.
 */
async function completeTick(deps: Readonly<RunTickDeps>, budgetMs: number): Promise<CompletedTick> {
	const { db, env, now = () => new Date(), steps, storage } = deps;
	const startedAt = now();
	const deadline = startedAt.getTime() + budgetMs;
	const outcome = await runSteps(steps, { db, deadline, env, now, storage });
	const report: CompletedTick = {
		finishedAt: now().toISOString(),
		moreWork: outcome.moreWork,
		startedAt: startedAt.toISOString(),
		status: 'completed',
		steps: outcome.steps,
	};
	await setState(db, 'last_tick', report);
	return report;
}

/**
 * Completes the tick and releases the lock, also when the tick fails.
 *
 * @param deps The database, the environment, the steps and the clock.
 * @param budgetMs The time budget of the steps.
 * @param holderId The holder of the lock.
 * @returns The report.
 */
async function completeTickAndRelease(
	deps: Readonly<RunTickDeps>,
	budgetMs: number,
	holderId: string,
): Promise<CompletedTick> {
	try {
		return await completeTick(deps, budgetMs);
	} finally {
		await releaseLock(deps.db, holderId);
	}
}

/**
 * Runs one tick: takes the lock, runs the steps within the budget, stores the report under
 * `last_tick`, releases the lock (also on failure) and then pings the heartbeat.
 *
 * @param deps The database, the environment, the steps and optional overrides for tests.
 * @returns The report, or `{ status: 'locked' }` while another run holds the lock.
 */
async function runTick(deps: Readonly<RunTickDeps>): Promise<TickReport> {
	const { budgetMs = TICK_BUDGET_MS, db, env, fetchFn = defaultFetch } = deps;
	const holderId = deps.holderId ?? crypto.randomUUID();
	if (!(await acquireLock(db, holderId, budgetMs + LOCK_GRACE_MS))) return { status: 'locked' };
	const report = await completeTickAndRelease(deps, budgetMs, holderId);
	await pingHeartbeat(env.heartbeatUrl, fetchFn);
	return report;
}

/**
 * Reads the report of the last completed tick.
 *
 * @param db The database.
 * @returns The report, or null before the first tick.
 */
async function getLastTick(db: Db): Promise<CompletedTick | null> {
	return getState<CompletedTick>(db, 'last_tick');
}

export { TICK_BUDGET_MS, getLastTick, runTick };
export type { CompletedTick, RunTickDeps, TickContext, TickReport, TickStep, TickStepResult };
