/*
 * The tick step of Graph's bounce reports (Design 13): for each Graph sender it reads the new
 * reports (NDR) of the sender's own inbox through the adapter (`fetchBounces`, `Mail.Read`; nothing
 * is moved or deleted) and records each of them once (`processed_reports`), matched to its outbox
 * entry by the Message-ID of the mail that bounced.
 *
 * A sender's check starts where its last one ended (a `system_state` marker per sender; the first
 * from the time the sender was made) and reads at most `GRAPH_BOUNCES_PER_RUN` reports, oldest
 * first. Graph's query repeats the reports of its boundary second, which `processed_reports` skips.
 * The limit must stay well above the reports of one second, or the marker could not move past them:
 * a Graph sender sends at most 30 mails a minute (Exchange's limit), so far fewer bounces come back
 * per second.
 *
 * The format of a report (the original Message-ID in `In-Reply-To` or `References`, a DSN status
 * line in the body) is not verified against a real tenant (4a follow-up); `parseNdr` reads it
 * defensively and skips what it cannot read, and `graph-step.test.ts` pins the assumed shape.
 *
 * A sender whose connection is disturbed, or whose secret does not decrypt, is skipped; the outbox
 * deals with the disturbance. A provider's refusal is logged by its code and the next sender goes
 * on. The step respects the tick's deadline and, on Cloudflare, the subrequests the invocation has
 * left (two per sender: the token and the inbox).
 */
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { budgetedFetch, isSubrequestLimit, SUBREQUEST_LIMIT_CODE } from '@/platform/subrequests';
import type { SubrequestBudget } from '@/platform/subrequests';
import type { Db } from '@/server/db/client';
import { mailConnections, processedReports, senders } from '@/server/db/schema';
import { errorLabel } from '@/server/error-label';
import { openSenderTransport } from '@/server/sending/open-transport';
import type { BounceReport } from '@/server/sending/transport';
import { getState, setState } from '@/server/system-state';
import type { StateKey } from '@/server/system-state';
import type { TickContext, TickStep } from '@/server/tick/tick';

import { recordBounce } from './bounces';

/** What the step needs besides the tick: the `fetch` of the provider requests. */
interface GraphBouncesDeps {
	readonly fetch: typeof fetch;
}

/** A Graph sender as the step reads it. */
interface GraphSender {
	readonly id: string;
	readonly connectionId: string;
	readonly createdAt: Date;
	readonly disturbedSince: Date | null;
}

/** What the check of one sender came to. */
type SenderOutcome = 'done' | 'full' | 'spent';

/** The reports one sender's check reads at most. */
const GRAPH_BOUNCES_PER_RUN = 50;
/** A sender's check costs a token and the inbox read. */
const REQUESTS_PER_SENDER = 2;
/** A code of the Graph adapter, e.g. `graph.mailbox`: safe to log. */
const ADAPTER_CODE = /^[a-z]+\.[A-Za-z]+$/u;

const markerSchema = z.object({ since: z.iso.datetime() });

/**
 * The key of a sender's marker.
 *
 * @param senderId The sender.
 * @returns The key.
 */
function markerKey(senderId: string): StateKey {
	return `graph_bounces_since:${senderId}`;
}

/**
 * The loggable code of a provider error: the adapter throws its codes as messages.
 *
 * @param error Whatever was thrown.
 * @returns The adapter's code, or the label of the error.
 */
function providerCode(error: unknown): string {
	return error instanceof Error && ADAPTER_CODE.test(error.message)
		? error.message
		: errorLabel(error);
}

/**
 * The Graph senders, oldest first, with the disturbance of their connection.
 *
 * @param db The database.
 * @returns The senders.
 */
async function graphSenders(db: Db): Promise<GraphSender[]> {
	return db
		.select({
			connectionId: senders.connectionId,
			createdAt: senders.createdAt,
			disturbedSince: mailConnections.disturbedSince,
			id: senders.id,
		})
		.from(senders)
		.innerJoin(mailConnections, eq(mailConnections.id, senders.connectionId))
		.where(eq(mailConnections.kind, 'graph'))
		.orderBy(asc(senders.createdAt), asc(senders.id));
}

/**
 * Where a sender's check starts: its marker, or the time it was made.
 *
 * @param db The database.
 * @param sender The sender.
 * @returns The time.
 */
async function startOf(db: Db, sender: Readonly<GraphSender>): Promise<Date> {
	const parsed = markerSchema.safeParse(await getState<unknown>(db, markerKey(sender.id)));
	return parsed.success ? new Date(parsed.data.since) : sender.createdAt;
}

/**
 * Records a report once: a report the connection processed before changes nothing.
 *
 * @param db The database.
 * @param connectionId The connection of the sender's mailbox.
 * @param report The report.
 * @param now The time of the run.
 */
// oxlint-disable-next-line max-params -- the database, the connection, the report and the time
async function processReport(
	db: Db,
	connectionId: string,
	report: Readonly<BounceReport>,
	now: Date,
): Promise<void> {
	await db.transaction(async (tx) => {
		const fresh = await tx
			.insert(processedReports)
			.values({ connectionId, processedAt: now, reportId: report.reportId })
			.onConflictDoNothing()
			.returning({ reportId: processedReports.reportId });
		if (fresh.length === 0) return;
		await recordBounce(tx, {
			at: report.receivedAt,
			entry: { messageId: report.originalMessageId },
			hard: report.hard,
			source: 'graph',
		});
	});
}

/**
 * Whether the invocation has too few subrequests left for a sender's check.
 *
 * @param budget The subrequests left, or null without a limit.
 * @returns True when the check must wait for the next invocation.
 */
function spent(budget: SubrequestBudget | null): boolean {
	return budget !== null && budget.left() < REQUESTS_PER_SENDER;
}

/**
 * One run of the step.
 */
class GraphBouncesRun {
	/** The `fetch` of the transports: it takes every request from the invocation's budget. */
	private readonly fetch: typeof fetch;
	/** Reports that could not be recorded; the run throws them at its end. */
	private readonly failures: unknown[] = [];

	/**
	 * @param ctx The tick.
	 * @param deps The `fetch` of the provider requests.
	 */
	public constructor(
		private readonly ctx: TickContext,
		deps: Readonly<GraphBouncesDeps>,
	) {
		this.fetch = budgetedFetch(deps.fetch, ctx.subrequests);
	}

	/**
	 * Checks every Graph sender until done, the deadline or the subrequests left.
	 *
	 * @returns Whether a sender has more reports than one check reads.
	 * @throws {AggregateError} When reports could not be recorded; they are read again next time.
	 */
	public async run(): Promise<{ moreWork: boolean }> {
		const moreWork = await this.checkAll();
		if (this.failures.length > 0) {
			throw new AggregateError(this.failures, 'Recording bounce reports failed.');
		}
		return { moreWork };
	}

	private async checkAll(): Promise<boolean> {
		let moreWork = false;
		for (const sender of await graphSenders(this.ctx.db)) {
			if (this.passedDeadline()) return true;
			// The next cron event goes on: no later tick of this invocation could read either.
			if (spent(this.ctx.subrequests)) return moreWork;
			// oxlint-disable-next-line no-await-in-loop -- one sender after another, within the budgets
			const outcome = await this.checkSafely(sender);
			if (outcome === 'spent') return moreWork;
			moreWork ||= outcome === 'full';
		}
		return moreWork;
	}

	private passedDeadline(): boolean {
		return this.ctx.now().getTime() >= this.ctx.deadline;
	}

	/**
	 * Checks a sender; a disturbed connection, a secret that does not decrypt or a refusal of the
	 * provider skips it, logged by code.
	 *
	 * @param sender The sender.
	 * @returns What the check came to.
	 */
	private async checkSafely(sender: Readonly<GraphSender>): Promise<SenderOutcome> {
		if (sender.disturbedSince !== null) {
			// oxlint-disable-next-line no-console -- a code only
			console.error('graph bounces skipped', 'connection.disturbed');
			return 'done';
		}
		try {
			return await this.check(sender);
		} catch (error) {
			const code = providerCode(error);
			if (code === SUBREQUEST_LIMIT_CODE || isSubrequestLimit(error)) return 'spent';
			// oxlint-disable-next-line no-console -- a code only, never an address
			console.error('graph bounces skipped', code);
			return 'done';
		}
	}

	/**
	 * Reads a sender's new reports and records them. The marker moves to the last report read, or
	 * to the report the deadline or a failure stopped at, which the next check reads again.
	 *
	 * @param sender The sender.
	 * @returns `full` when the check read as many reports as it may or stopped at the deadline.
	 */
	private async check(sender: Readonly<GraphSender>): Promise<SenderOutcome> {
		const read = await this.read(sender);
		if (read === null) return 'done';
		const { reports, since, until } = read;
		const stop = await this.recordAll(sender.connectionId, reports);
		await this.saveMarker(sender.id, since, stop?.at ?? until ?? since);
		const full = stop?.deadline === true || reports.length >= GRAPH_BOUNCES_PER_RUN;
		return full ? 'full' : 'done';
	}

	/**
	 * Reads the new reports of a sender's inbox.
	 *
	 * @param sender The sender.
	 * @returns Where the check started, the reports and the time of the last message read; null
	 *   for a transport without bounce reports.
	 */
	private async read(
		sender: Readonly<GraphSender>,
	): Promise<{ since: Date; reports: BounceReport[]; until: Date | null } | null> {
		const { db, env, now } = this.ctx;
		const opened = await openSenderTransport(db, env, sender.id, { fetch: this.fetch, now });
		const { fetchBounces } = opened.transport;
		if (fetchBounces === null) return null;
		const since = await startOf(db, sender);
		const { reports, until } = await fetchBounces(since, GRAPH_BOUNCES_PER_RUN);
		return { reports, since, until };
	}

	/**
	 * Records reports one after another until the deadline or a failure.
	 *
	 * @param connectionId The connection of the sender.
	 * @param reports The reports, oldest first.
	 * @returns The report the deadline or a failure stopped at; null when all were recorded.
	 */
	private async recordAll(
		connectionId: string,
		reports: readonly BounceReport[],
	): Promise<{ at: Date; deadline: boolean } | null> {
		for (const report of reports) {
			if (this.passedDeadline()) return { at: report.receivedAt, deadline: true };
			// oxlint-disable-next-line no-await-in-loop -- one report after another, each once
			if (!(await this.record(connectionId, report))) {
				return { at: report.receivedAt, deadline: false };
			}
		}
		return null;
	}

	/**
	 * Records a report; a failure is kept for the end of the run.
	 *
	 * @param connectionId The connection of the sender.
	 * @param report The report.
	 * @returns False when it could not be recorded.
	 */
	private async record(connectionId: string, report: Readonly<BounceReport>): Promise<boolean> {
		try {
			await processReport(this.ctx.db, connectionId, report, this.ctx.now());
			return true;
		} catch (error) {
			this.failures.push(error);
			return false;
		}
	}

	/**
	 * Moves a sender's marker forward, never back.
	 *
	 * @param senderId The sender.
	 * @param since Where the check started.
	 * @param next Where the next check starts.
	 */
	private async saveMarker(senderId: string, since: Date, next: Date): Promise<void> {
		if (next.getTime() <= since.getTime()) return;
		await setState(this.ctx.db, markerKey(senderId), { since: next.toISOString() });
	}
}

/**
 * Makes the step.
 *
 * @param deps The `fetch` of the provider requests.
 * @returns The step.
 */
function createGraphBouncesStep(deps: Readonly<GraphBouncesDeps>): TickStep {
	return {
		name: 'graph-bounces',
		run: async (ctx) => new GraphBouncesRun(ctx, deps).run(),
	};
}

/** The step of every tick, with the platform's `fetch`. */
const graphBounces: TickStep = createGraphBouncesStep({
	fetch: async (input, init) => fetch(input, init),
});

export { createGraphBouncesStep, graphBounces, GRAPH_BOUNCES_PER_RUN };
export type { GraphBouncesDeps };
