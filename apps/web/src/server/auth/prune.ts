import { inArray, lt, lte, sql } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { loginLinkWindow, verification } from '@/server/db/schema';
import type { TickContext, TickStep } from '@/server/tick/tick';

import { LOGIN_LINK_WINDOW_SECONDS } from './login-window';

/** Rows per delete statement, so one statement never locks or scans too much at once. */
const PRUNE_BATCH_SIZE = 500;

/** Deletes up to one batch and returns how many rows it deleted. */
type BatchDelete = (db: Db, batchSize: number) => Promise<number>;

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
		.where(lt(verification.expiresAt, sql`now()`))
		.limit(batchSize);
	const deleted = await db
		.delete(verification)
		.where(inArray(verification.id, expired))
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
		.where(
			lte(
				loginLinkWindow.openedAt,
				sql`now() - make_interval(secs => ${LOGIN_LINK_WINDOW_SECONDS})`,
			),
		)
		.limit(batchSize);
	const deleted = await db
		.delete(loginLinkWindow)
		.where(inArray(loginLinkWindow.emailHash, closed))
		.returning({ emailHash: loginLinkWindow.emailHash });
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

/**
 * Builds the step that deletes expired verification rows and closed login link windows, both
 * judged by the database clock.
 *
 * @param batchSize Rows per delete statement; tests make it small.
 * @returns The `prune-auth-records` tick step.
 */
function createPruneAuthRecordsStep(batchSize: number = PRUNE_BATCH_SIZE): TickStep {
	return {
		name: 'prune-auth-records',
		async run(ctx) {
			for (const deleteBatch of [deleteExpiredVerifications, deleteClosedLoginWindows]) {
				// oxlint-disable-next-line no-await-in-loop -- the tables are pruned one after another
				if (await deleteUntilDone(ctx, deleteBatch, batchSize)) return { moreWork: true };
			}
			return { moreWork: false };
		},
	};
}

const pruneAuthRecords = createPruneAuthRecordsStep();

export { createPruneAuthRecordsStep, pruneAuthRecords };
