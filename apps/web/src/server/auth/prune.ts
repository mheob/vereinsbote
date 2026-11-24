import { and, inArray, lt, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { loginLinkWindow, rateLimit, session, verification } from '@/server/db/schema';
import type { TickContext, TickStep } from '@/server/tick/tick';

import { LOGIN_LINK_WINDOW_SECONDS, LONGEST_RATE_LIMIT_WINDOW_SECONDS } from './sign-in-limits';

/** Rows per delete statement, so one statement never locks or scans too much at once. */
const PRUNE_BATCH_SIZE = 500;
/**
 * A rate limiter row idle for this long counts for nothing: twice the longest window, so a skew
 * between the clocks of app and database (Better Auth stores the app's time) never ends a window
 * that is still running.
 */
const MS_PER_SECOND = 1000;
const STALE_RATE_LIMIT_MS = 2 * LONGEST_RATE_LIMIT_WINDOW_SECONDS * MS_PER_SECOND;

/** Deletes up to one batch and returns how many rows it deleted. */
type BatchDelete = (db: Db, batchSize: number) => Promise<number>;

/*
 * Each delete repeats its age condition on the rows it deletes, not only in the batch subquery:
 * a row that another request renewed in the meantime (a reopened login window) is checked again
 * after its lock and then kept.
 */

function isExpiredVerification(): SQL {
	return lt(verification.expiresAt, sql`now()`);
}

function isExpiredSession(): SQL {
	return lt(session.expiresAt, sql`now()`);
}

function isStaleRateLimit(): SQL {
	return lt(
		rateLimit.lastRequest,
		sql`(extract(epoch from now()) * 1000)::bigint - ${STALE_RATE_LIMIT_MS}`,
	);
}

function isClosedLoginWindow(): SQL {
	return lte(
		loginLinkWindow.openedAt,
		sql`now() - make_interval(secs => ${LOGIN_LINK_WINDOW_SECONDS})`,
	);
}

/**
 * Deletes expired Better Auth verification rows (used or unused login links).
 *
 * @param db The database.
 * @param batchSize The most rows to delete.
 * @returns How many rows it deleted.
 */
const deleteExpiredVerifications: BatchDelete = async (db, batchSize) => {
	const expired = db
		.select({ id: verification.id })
		.from(verification)
		.where(isExpiredVerification())
		.limit(batchSize);
	const deleted = await db
		.delete(verification)
		.where(and(inArray(verification.id, expired), isExpiredVerification()))
		.returning({ id: verification.id });
	return deleted.length;
};

/**
 * Deletes login link windows that have closed. The sign-in treats them as absent already (it
 * reopens a window older than `LOGIN_LINK_WINDOW_SECONDS`), so deleting them changes no behavior.
 *
 * @param db The database.
 * @param batchSize The most rows to delete.
 * @returns How many rows it deleted.
 */
const deleteClosedLoginWindows: BatchDelete = async (db, batchSize) => {
	const closed = db
		.select({ emailHash: loginLinkWindow.emailHash })
		.from(loginLinkWindow)
		.where(isClosedLoginWindow())
		.limit(batchSize);
	const deleted = await db
		.delete(loginLinkWindow)
		.where(and(inArray(loginLinkWindow.emailHash, closed), isClosedLoginWindow()))
		.returning({ emailHash: loginLinkWindow.emailHash });
	return deleted.length;
};

/**
 * Deletes expired sessions. Better Auth refuses them already, so deleting them changes no
 * behavior; it keeps the table, and the client addresses stored with each session, small.
 *
 * @param db The database.
 * @param batchSize The most rows to delete.
 * @returns How many rows it deleted.
 */
const deleteExpiredSessions: BatchDelete = async (db, batchSize) => {
	const expired = db
		.select({ id: session.id })
		.from(session)
		.where(isExpiredSession())
		.limit(batchSize);
	const deleted = await db
		.delete(session)
		.where(and(inArray(session.id, expired), isExpiredSession()))
		.returning({ id: session.id });
	return deleted.length;
};

/**
 * Deletes Better Auth's rate limiter rows that are idle for longer than any window. Each row
 * holds a client address, and the limiter starts such a counter over anyway.
 *
 * @param db The database.
 * @param batchSize The most rows to delete.
 * @returns How many rows it deleted.
 */
const deleteStaleRateLimits: BatchDelete = async (db, batchSize) => {
	const stale = db
		.select({ id: rateLimit.id })
		.from(rateLimit)
		.where(isStaleRateLimit())
		.limit(batchSize);
	const deleted = await db
		.delete(rateLimit)
		.where(and(inArray(rateLimit.id, stale), isStaleRateLimit()))
		.returning({ id: rateLimit.id });
	return deleted.length;
};

/**
 * Deletes batch after batch until a batch comes back short (nothing left) or the deadline passes.
 *
 * @param ctx The tick context.
 * @param deleteBatch Deletes one batch.
 * @param batchSize The batch size.
 * @returns True when the deadline stopped it while rows may be left.
 */
async function deleteUntilDone(
	ctx: TickContext,
	deleteBatch: BatchDelete,
	batchSize: number,
): Promise<boolean> {
	for (;;) {
		if (ctx.now().getTime() >= ctx.deadline) return true;
		// oxlint-disable-next-line no-await-in-loop -- each batch is one short statement, by design
		const deleted = await deleteBatch(ctx.db, batchSize);
		if (deleted < batchSize) return false;
	}
}

/** The deletes of the step, in the order it runs them. */
const BATCH_DELETES: readonly BatchDelete[] = [
	deleteExpiredVerifications,
	deleteClosedLoginWindows,
	deleteExpiredSessions,
	deleteStaleRateLimits,
];

/**
 * Builds the step that deletes expired verification rows, closed login link windows, expired
 * sessions and stale rate limiter rows, all judged by the database clock, within the step's time
 * budget.
 *
 * @param batchSize Rows per delete statement; tests make it small.
 * @returns The `prune-auth-records` tick step.
 */
function createPruneAuthRecordsStep(batchSize: number = PRUNE_BATCH_SIZE): TickStep {
	return {
		name: 'prune-auth-records',
		async run(ctx) {
			for (const deleteBatch of BATCH_DELETES) {
				// oxlint-disable-next-line no-await-in-loop -- the tables are pruned one after another
				if (await deleteUntilDone(ctx, deleteBatch, batchSize)) return { moreWork: true };
			}
			return { moreWork: false };
		},
	};
}

const pruneAuthRecords = createPruneAuthRecordsStep();

export { createPruneAuthRecordsStep, pruneAuthRecords };
