import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vite-plus/test';

import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';
import { getState, setState } from '@/server/system-state';

import { getLastTick, runTick, TICK_BUDGET_MS } from './tick';
import type { CompletedTick, TickContext, TickReport, TickStep } from './tick';

const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 5).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://x@localhost/x',
});

const HEARTBEAT_URL = 'https://hc.example.org/x';
const START = Date.parse('2026-11-23T10:00:00.000Z');
const ONE_MINUTE_MS = 60_000;
/** Slack for the comparison of the app clock with the database clock. */
const CLOCK_SLACK_MS = 1000;

interface StepResult {
	readonly moreWork: boolean;
}

interface Lock {
	readonly expiresAt: string;
	readonly holderId: string;
}

/**
 * Builds a tick step.
 *
 * @param name The step name.
 * @param run What the step does.
 * @returns The step.
 */
function step(name: string, run: (ctx: TickContext) => Promise<StepResult>): TickStep {
	return { name, run };
}

/** Step bodies; mocks, so they return promises without being async functions themselves. */
const noWork = vi.fn<TickStep['run']>().mockResolvedValue({ moreWork: false });
const moreWork = vi.fn<TickStep['run']>().mockResolvedValue({ moreWork: true });
const broken = vi.fn<TickStep['run']>().mockRejectedValue(new Error('kaputt'));
const brokenQuery = vi
	.fn<TickStep['run']>()
	.mockRejectedValue(new Error('Failed query: select 1\nparams: anna@verein.de'));

/**
 * Narrows a report to a completed tick.
 *
 * @param report The report.
 * @returns The completed tick.
 * @throws {Error} When the tick did not complete.
 */
function completedTick(report: TickReport): CompletedTick {
	if (report.status !== 'completed')
		throw new Error(`expected a completed tick, got ${report.status}`);
	return report;
}

/**
 * A lock that expires the given milliseconds from now (negative: expired).
 *
 * @param holderId The holder.
 * @param offsetMs The expiry offset.
 * @returns The lock value.
 */
function lockExpiringIn(holderId: string, offsetMs: number): Lock {
	return { expiresAt: new Date(Date.now() + offsetMs).toISOString(), holderId };
}

/**
 * The expiry of a stored lock in epoch milliseconds.
 *
 * @param lock The stored lock.
 * @returns The expiry, or NaN without a lock.
 */
function expiryOf(lock: Lock | null): number {
	return lock === null ? Number.NaN : Date.parse(lock.expiresAt);
}

describe(runTick, () => {
	it('runs steps in order and stores the report', async () => {
		const db = await createTestDb();
		const order: string[] = [];
		const record =
			(name: string) =>
			async (ctx: TickContext): Promise<StepResult> => {
				order.push(name);
				return noWork(ctx);
			};
		const report = await runTick({
			db,
			env,
			steps: [step('a', record('a')), step('b', record('b'))],
		});
		expect(order).toStrictEqual(['a', 'b']);
		expect(report).toMatchObject({
			moreWork: false,
			status: 'completed',
			steps: [
				{ name: 'a', outcome: 'done' },
				{ name: 'b', outcome: 'done' },
			],
		});
		await expect(getLastTick(db)).resolves.toStrictEqual(report);
	});

	it('hands each step the database, the env, the clock and the deadline', async () => {
		const db = await createTestDb();
		const now = (): Date => new Date(START);
		const seen: TickContext[] = [];
		const capture = async (ctx: TickContext): Promise<StepResult> => {
			seen.push(ctx);
			return noWork(ctx);
		};
		await runTick({ budgetMs: 1000, db, env, now, steps: [step('a', capture)] });
		expect(seen).toStrictEqual([{ db, deadline: START + 1000, env, now }]);
	});

	it('records start and finish time from the clock', async () => {
		const db = await createTestDb();
		let current = START;
		const fiveSeconds = async (ctx: TickContext): Promise<StepResult> => {
			current += 5000;
			return noWork(ctx);
		};
		const report = await runTick({
			db,
			env,
			now: () => new Date(current),
			steps: [step('a', fiveSeconds)],
		});
		expect(report).toMatchObject({
			finishedAt: new Date(START + 5000).toISOString(),
			startedAt: new Date(START).toISOString(),
		});
	});

	it('continues after a failing step', async () => {
		const db = await createTestDb();
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const report = completedTick(
			await runTick({ db, env, steps: [step('a', broken), step('b', noWork)] }),
		);
		expect(report.steps).toStrictEqual([
			{ error: 'kaputt', name: 'a', outcome: 'error' },
			{ name: 'b', outcome: 'done' },
		]);
		expect(report.moreWork).toBe(false);
		expect(log).toHaveBeenCalledWith('tick step failed', 'a', 'Error');
		log.mockRestore();
	});

	it('reports only the first line of an error message', async () => {
		const db = await createTestDb();
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const report = completedTick(await runTick({ db, env, steps: [step('a', brokenQuery)] }));
		expect(report.steps).toStrictEqual([
			{ error: 'Failed query: select 1', name: 'a', outcome: 'error' },
		]);
		expect(JSON.stringify(log.mock.calls)).not.toContain('anna@verein.de');
		log.mockRestore();
	});

	it('skips steps after the deadline and reports more work', async () => {
		const db = await createTestDb();
		let current = START;
		const exhaustBudget = async (ctx: TickContext): Promise<StepResult> => {
			current += TICK_BUDGET_MS;
			return noWork(ctx);
		};
		const late = vi.fn<TickStep['run']>().mockResolvedValue({ moreWork: false });
		const report = await runTick({
			db,
			env,
			now: () => new Date(current),
			steps: [step('a', exhaustBudget), step('b', late)],
		});
		expect(late).not.toHaveBeenCalled();
		expect(report).toMatchObject({
			moreWork: true,
			status: 'completed',
			steps: [
				{ name: 'a', outcome: 'done' },
				{ name: 'b', outcome: 'skipped' },
			],
		});
	});

	it('propagates moreWork from a step', async () => {
		const db = await createTestDb();
		const report = await runTick({ db, env, steps: [step('a', moreWork), step('b', noWork)] });
		expect(report).toMatchObject({ moreWork: true, status: 'completed' });
	});

	it('refuses to run while another tick holds the lock', async () => {
		const db = await createTestDb();
		const gate = Promise.withResolvers<StepResult>();
		const started = Promise.withResolvers<string>();
		const slow = async (): Promise<StepResult> => {
			started.resolve('started');
			return gate.promise;
		};
		const first = runTick({ db, env, holderId: 'A', steps: [step('slow', slow)] });
		await started.promise;
		await expect(runTick({ db, env, holderId: 'B', steps: [] })).resolves.toStrictEqual({
			status: 'locked',
		});
		gate.resolve({ moreWork: false });
		await expect(first).resolves.toMatchObject({ status: 'completed' });
		await expect(runTick({ db, env, holderId: 'B', steps: [] })).resolves.toMatchObject({
			status: 'completed',
		});
	});

	it('neither runs nor stores a report while the lock is held', async () => {
		const db = await createTestDb();
		const lock = lockExpiringIn('X', ONE_MINUTE_MS);
		await setState(db, 'tick_lock', lock);
		const work = vi.fn<TickStep['run']>().mockResolvedValue({ moreWork: false });
		await expect(
			runTick({ db, env, holderId: 'B', steps: [step('a', work)] }),
		).resolves.toStrictEqual({ status: 'locked' });
		expect(work).not.toHaveBeenCalled();
		await expect(getLastTick(db)).resolves.toBeNull();
		await expect(getState(db, 'tick_lock')).resolves.toStrictEqual(lock);
	});

	it('takes over an expired lock', async () => {
		const db = await createTestDb();
		await setState(db, 'tick_lock', lockExpiringIn('X', -ONE_MINUTE_MS));
		await expect(runTick({ db, env, holderId: 'B', steps: [] })).resolves.toMatchObject({
			status: 'completed',
		});
	});

	it('takes over a lock without a readable expiry', async () => {
		const db = await createTestDb();
		await setState(db, 'tick_lock', { holderId: 'X' });
		await expect(runTick({ db, env, holderId: 'B', steps: [] })).resolves.toMatchObject({
			status: 'completed',
		});
	});

	it('holds the lock for the budget plus one minute', async () => {
		const db = await createTestDb();
		const seen: (Lock | null)[] = [];
		const peek = async (ctx: TickContext): Promise<StepResult> => {
			seen.push(await getState<Lock>(db, 'tick_lock'));
			return noWork(ctx);
		};
		const before = Date.now();
		await runTick({ budgetMs: 1000, db, env, holderId: 'A', steps: [step('peek', peek)] });
		const [lock = null] = seen;
		expect(lock).toMatchObject({ holderId: 'A' });
		expect(expiryOf(lock)).toBeGreaterThanOrEqual(before + 1000 + ONE_MINUTE_MS - CLOCK_SLACK_MS);
		expect(expiryOf(lock)).toBeLessThanOrEqual(Date.now() + 1000 + ONE_MINUTE_MS + CLOCK_SLACK_MS);
	});

	it('releases the lock after the tick', async () => {
		const db = await createTestDb();
		await runTick({ db, env, holderId: 'A', steps: [] });
		await expect(getState(db, 'tick_lock')).resolves.toBeNull();
	});

	it('releases the lock when storing the report fails', async () => {
		const db = await createTestDb();
		// The database rejects the report, so the tick fails after its steps ran.
		await db.execute(sql`
			create function reject_last_tick() returns trigger language plpgsql as $$
			begin
				if new.key = 'last_tick' then raise exception 'report rejected'; end if;
				return new;
			end $$`);
		await db.execute(sql`
			create trigger reject_last_tick before insert or update on system_state
			for each row execute function reject_last_tick()`);
		await expect(runTick({ db, env, holderId: 'A', steps: [] })).rejects.toMatchObject({
			cause: { message: 'report rejected' },
		});
		await expect(getState(db, 'tick_lock')).resolves.toBeNull();
	});

	it('does not release a lock that another holder took over', async () => {
		const db = await createTestDb();
		const stolen = lockExpiringIn('C', ONE_MINUTE_MS);
		const steal = async (ctx: TickContext): Promise<StepResult> => {
			await setState(db, 'tick_lock', stolen);
			return noWork(ctx);
		};
		await runTick({ db, env, holderId: 'A', steps: [step('steal', steal)] });
		await expect(getState(db, 'tick_lock')).resolves.toStrictEqual(stolen);
	});

	it('pings the heartbeat once and ignores its failure', async () => {
		const db = await createTestDb();
		const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const report = await runTick({
			db,
			env: { ...env, heartbeatUrl: HEARTBEAT_URL },
			fetchFn,
			steps: [],
		});
		expect(report.status).toBe('completed');
		expect(fetchFn).toHaveBeenCalledExactlyOnceWith(HEARTBEAT_URL, expect.anything());
		expect(log).toHaveBeenCalledWith('tick heartbeat failed', 'Error');
		expect(JSON.stringify(log.mock.calls)).not.toContain('hc.example.org');
		log.mockRestore();
	});

	it('logs a heartbeat that answers with an error status', async () => {
		const db = await createTestDb();
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const report = await runTick({
			db,
			env: { ...env, heartbeatUrl: HEARTBEAT_URL },
			fetchFn,
			steps: [],
		});
		expect(report.status).toBe('completed');
		expect(log).toHaveBeenCalledWith('tick heartbeat failed', 'HTTP 503');
		log.mockRestore();
	});

	it('pings no heartbeat without a URL or while locked', async () => {
		const db = await createTestDb();
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response());
		await runTick({ db, env, fetchFn, steps: [] });
		await setState(db, 'tick_lock', lockExpiringIn('X', ONE_MINUTE_MS));
		await runTick({ db, env: { ...env, heartbeatUrl: HEARTBEAT_URL }, fetchFn, steps: [] });
		expect(fetchFn).not.toHaveBeenCalled();
	});
});

describe(getLastTick, () => {
	it('returns null before the first tick', async () => {
		const db = await createTestDb();
		await expect(getLastTick(db)).resolves.toBeNull();
	});
});
