import { and, asc, eq, isNull, lt } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { attachments } from '@/server/db/schema';
import type { ObjectStorage } from '@/server/storage/storage';
import type { TickStep } from '@/server/tick/tick';

import { attachmentStorageKey } from './attachments';

const DAY_MS = 86_400_000;
/** Attachments one run looks at; a full batch asks for a follow-up tick. */
const BATCH_SIZE = 100;

async function staleIds(db: Db, now: Date): Promise<string[]> {
	const cutoff = new Date(now.getTime() - DAY_MS);
	const rows = await db
		.select({ id: attachments.id })
		.from(attachments)
		.where(and(isNull(attachments.waveId), lt(attachments.createdAt, cutoff)))
		.orderBy(asc(attachments.createdAt))
		.limit(BATCH_SIZE);
	return rows.map(({ id }) => id);
}

// The object first, so a storage failure leaves the row and the next tick tries again.
async function removeStale(db: Db, storage: ObjectStorage, id: string): Promise<void> {
	await storage.delete(attachmentStorageKey(id));
	await db.delete(attachments).where(and(eq(attachments.id, id), isNull(attachments.waveId)));
}

/**
 * Removes the attachments of an aborted flow: files without a wave that are older than one day.
 * A run handles one batch, goes on after a failing file and throws the first failure at the end,
 * and stops at the tick's deadline. Without a storage nothing can be deleted.
 */
const attachmentCleanup: TickStep = {
	name: 'attachment-cleanup',
	async run({ db, deadline, now, storage }) {
		if (storage === null) return { moreWork: false };
		const ids = await staleIds(db, now());
		const failures: unknown[] = [];
		for (const id of ids) {
			if (now().getTime() >= deadline) return { moreWork: true };
			try {
				// oxlint-disable-next-line no-await-in-loop -- one file after another keeps the storage load low
				await removeStale(db, storage, id);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0) throw new AggregateError(failures, 'Removing attachments failed.');
		return { moreWork: ids.length === BATCH_SIZE };
	},
};

export { attachmentCleanup };
