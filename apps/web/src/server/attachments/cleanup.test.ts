import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import type { Db } from '@/server/db/client';
import { attachments } from '@/server/db/schema';
import { parseEnv } from '@/server/env';
import type { ObjectStorage } from '@/server/storage/storage';
import type { TickContext } from '@/server/tick/tick';

import { storeAttachment } from './attachments';
import type { AttachmentRecord } from './attachments';
import { attachmentCleanup } from './cleanup';
import { pdfBytes, setUpAttachments } from './testing';

const DAY_MS = 86_400_000;
const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 5).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://x@localhost/x',
});

function context(
	db: Db,
	storage: ObjectStorage | null,
	deadline = Number.MAX_SAFE_INTEGER,
): TickContext {
	return { db, deadline, env, now: () => new Date(), storage, subrequests: null };
}

// Stores an attachment and ages it by two days.
async function stored(): Promise<
	Awaited<ReturnType<typeof setUpAttachments>> & { record: AttachmentRecord }
> {
	const setUp = await setUpAttachments();
	const { db, occasionId, sender, storage } = setUp;
	const record = await storeAttachment(db, storage, sender, occasionId, {
		bytes: pdfBytes(),
		name: 'a.pdf',
	});
	await db
		.update(attachments)
		.set({ createdAt: new Date(Date.now() - 2 * DAY_MS) })
		.where(eq(attachments.id, record.id));
	return { ...setUp, record };
}

describe('attachment-cleanup', () => {
	it('removes attachments without a wave after one day', async () => {
		const { db, occasionId, record: old, sender, storage } = await stored();
		const fresh = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'b.pdf',
		});
		const inWave = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'c.pdf',
		});
		await db
			.update(attachments)
			.set({ createdAt: new Date(Date.now() - 2 * DAY_MS), waveId: randomUUID() })
			.where(eq(attachments.id, inWave.id));
		await expect(attachmentCleanup.run(context(db, storage))).resolves.toStrictEqual({
			moreWork: false,
		});
		const left = await db.select({ id: attachments.id }).from(attachments);
		expect(left.map(({ id }) => id).toSorted()).toStrictEqual([fresh.id, inWave.id].toSorted());
		await expect(storage.get(`attachments/${old.id}`)).resolves.toBeNull();
		await expect(storage.get(`attachments/${inWave.id}`)).resolves.not.toBeNull();
	});

	it('keeps the row when the object cannot be deleted, and tries again later', async () => {
		const { db, storage } = await stored();
		const failing: ObjectStorage = {
			...storage,
			async delete(): Promise<void> {
				await Promise.reject(new Error('storage down'));
			},
		};
		await expect(attachmentCleanup.run(context(db, failing))).rejects.toThrow(
			'Removing attachments failed.',
		);
		await expect(db.select().from(attachments)).resolves.toHaveLength(1);
		await attachmentCleanup.run(context(db, storage));
		await expect(db.select().from(attachments)).resolves.toHaveLength(0);
	});

	it('does nothing without a storage and reports no more work', async () => {
		const { db } = await stored();
		await expect(attachmentCleanup.run(context(db, null))).resolves.toStrictEqual({
			moreWork: false,
		});
		await expect(db.select().from(attachments)).resolves.toHaveLength(1);
	});

	it('stops at the deadline and asks for more work', async () => {
		const { db, storage } = await stored();
		await expect(attachmentCleanup.run(context(db, storage, 0))).resolves.toStrictEqual({
			moreWork: true,
		});
		await expect(db.select().from(attachments)).resolves.toHaveLength(1);
	});
});
