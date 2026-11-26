import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { userWith } from '@/server/contacts/testing';
import { attachments, occasions } from '@/server/db/schema';
import { OccasionInvalidError, OccasionNotFoundError } from '@/server/occasions/errors';
import { removeOccasion } from '@/server/occasions/occasions';
import { insertOccasion } from '@/server/occasions/testing';
import { ForbiddenError } from '@/server/permissions/principal';
import type { ObjectStorage } from '@/server/storage/storage';
import { insertWave } from '@/server/waves/testing';

import {
	checkRoom,
	deleteFreeAttachment,
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENTS,
	MAX_ATTACHMENTS_TOTAL,
	readAttachments,
	removeAttachment,
	storeAttachment,
} from './attachments';
import type { AttachmentRecord } from './attachments';
import {
	AttachmentInvalidError,
	AttachmentLockedError,
	AttachmentMissingError,
	AttachmentNotFoundError,
} from './errors';
import { bytesOf, pdfBytes, setUpAttachments } from './testing';

describe(storeAttachment, () => {
	it('stores the object under attachments/<id> and the row', async () => {
		const { db, membersAreaId, occasionId, sender, storage } = await setUpAttachments();
		const record = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: '../Anmeldung "Süd".pdf',
		});
		expect(record).toMatchObject({
			areaId: membersAreaId,
			name: 'Anmeldung Süd.pdf',
			size: 100,
			type: 'application/pdf',
			waveId: null,
		});
		expect(record.id).toMatch(/^[\w-]{22}$/u);
		await expect(storage.get(`attachments/${record.id}`)).resolves.toMatchObject({
			contentType: 'application/pdf',
			size: 100,
		});
		const [row] = await db.select().from(attachments).where(eq(attachments.id, record.id));
		expect(row).toMatchObject({ createdByUserId: sender.userId, occasionId });
	});

	it('refuses a renamed html file even with a pdf name', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		await expect(
			storeAttachment(db, storage, sender, occasionId, {
				bytes: bytesOf('<html><body>x</body></html>'),
				name: 'rechnung.pdf',
			}),
		).rejects.toMatchObject({ reason: 'type' });
		await expect(db.select().from(attachments)).resolves.toHaveLength(0);
	});

	it('refuses files over 4 MiB and a sixth file, but takes five of 4 MiB', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const add = async (length: number): Promise<AttachmentRecord> =>
			storeAttachment(db, storage, sender, occasionId, {
				bytes: pdfBytes(length),
				name: 'a.pdf',
			});
		await expect(add(MAX_ATTACHMENT_BYTES + 1)).rejects.toMatchObject({ reason: 'size' });
		for (let index = 0; index < MAX_ATTACHMENTS; index += 1) {
			// oxlint-disable-next-line no-await-in-loop -- one after another, the count matters
			await add(MAX_ATTACHMENT_BYTES);
		}
		await expect(add(10)).rejects.toMatchObject({ reason: 'count' });
	});

	it('does not count attachments of a wave or of another occasion', async () => {
		const { admin, db, membersAreaId, occasionId, sender, storage } = await setUpAttachments();
		const other = await insertOccasion(db, admin, membersAreaId, 'Andere');
		const add = async (id: string): Promise<AttachmentRecord> =>
			storeAttachment(db, storage, sender, id, { bytes: pdfBytes(), name: 'x.pdf' });
		for (let index = 0; index < MAX_ATTACHMENTS; index += 1) {
			// oxlint-disable-next-line no-await-in-loop -- one after another
			await add(other);
		}
		await expect(add(occasionId)).resolves.toBeDefined();
		await db
			.update(attachments)
			.set({ waveId: await insertWave(db, other) })
			.where(eq(attachments.occasionId, other));
		await expect(add(other)).resolves.toBeDefined();
	});

	it('needs send in the area', async () => {
		const { db, membersAreaId, occasionId, partnersAreaId, storage } = await setUpAttachments();
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		const elsewhere = await userWith(db, { [partnersAreaId]: 'send' });
		const file = { bytes: pdfBytes(), name: 'a.pdf' };
		await expect(storeAttachment(db, storage, editor, occasionId, file)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(storeAttachment(db, storage, elsewhere, occasionId, file)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});

	it('refuses an unknown occasion', async () => {
		const { db, sender, storage } = await setUpAttachments();
		await expect(
			storeAttachment(db, storage, sender, randomUUID(), { bytes: pdfBytes(), name: 'a.pdf' }),
		).rejects.toBeInstanceOf(OccasionNotFoundError);
	});

	it('refuses a file for an archived occasion and leaves no object behind', async () => {
		const { db, membersAreaId, occasionId, sender, storage } = await setUpAttachments();
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		await insertWave(db, occasionId);
		await expect(removeOccasion(db, editor, occasionId, 1)).resolves.toBe('archived');
		const written: string[] = [];
		const watching: ObjectStorage = {
			...storage,
			async put(key, bytes, options): Promise<void> {
				written.push(key);
				await storage.put(key, bytes, options);
			},
		};
		const refused = storeAttachment(db, watching, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'a.pdf',
		});
		await expect(refused).rejects.toBeInstanceOf(OccasionInvalidError);
		await expect(refused).rejects.toMatchObject({ problem: 'archived' });
		expect(written).toStrictEqual([]);
	});

	it('deletes the object again when the row cannot be written', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const deleted: string[] = [];
		const watching: ObjectStorage = {
			...storage,
			async delete(key: string): Promise<void> {
				deleted.push(key);
				await storage.delete(key);
			},
		};
		// The occasion disappears between the permission check and the transaction.
		const racing: ObjectStorage = {
			...watching,
			async put(key, bytes, options): Promise<void> {
				await storage.put(key, bytes, options);
				await db.delete(occasions).where(eq(occasions.id, occasionId));
			},
		};
		await expect(
			storeAttachment(db, racing, sender, occasionId, { bytes: pdfBytes(), name: 'a.pdf' }),
		).rejects.toBeInstanceOf(OccasionNotFoundError);
		expect(deleted).toHaveLength(1);
		await expect(storage.get(deleted.join(''))).resolves.toBeNull();
	});

	describe('when the cleanup fails too', () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('keeps the refusal and logs the cleanup by its label only', async () => {
			const { db, occasionId, sender, storage } = await setUpAttachments();
			const logged = vi.spyOn(console, 'error').mockReturnValue();
			for (let stored = 0; stored < MAX_ATTACHMENTS; stored += 1) {
				// oxlint-disable-next-line no-await-in-loop -- one file after another
				await storeAttachment(db, storage, sender, occasionId, {
					bytes: pdfBytes(),
					name: `${stored}.pdf`,
				});
			}
			const failing: ObjectStorage = {
				...storage,
				async delete(key: string): Promise<void> {
					await Promise.reject(new Error(`storage down at ${key}`));
				},
			};
			const refused = storeAttachment(db, failing, sender, occasionId, {
				bytes: pdfBytes(),
				name: 'sixth.pdf',
			});
			await expect(refused).rejects.toBeInstanceOf(AttachmentInvalidError);
			await expect(refused).rejects.toMatchObject({ reason: 'count' });
			expect(logged).toHaveBeenCalledOnce();
			expect(JSON.stringify(logged.mock.calls)).not.toContain('attachments/');
		});
	});
});

describe(checkRoom, () => {
	it('refuses a sixth file and more than 20 MiB together', () => {
		expect(() => {
			checkRoom(MAX_ATTACHMENTS, 0, 1);
		}).toThrow(AttachmentInvalidError);
		expect(() => {
			checkRoom(1, MAX_ATTACHMENTS_TOTAL - 9, 10);
		}).toThrow(AttachmentInvalidError);
		expect(() => {
			checkRoom(1, MAX_ATTACHMENTS_TOTAL - 10, 10);
		}).not.toThrow();
	});
});

describe(removeAttachment, () => {
	it('removes the row and the object', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const { id } = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'a.pdf',
		});
		await removeAttachment(db, storage, sender, id);
		await expect(db.select().from(attachments)).resolves.toHaveLength(0);
		await expect(storage.get(`attachments/${id}`)).resolves.toBeNull();
	});

	it('refuses an attachment of a wave, an unknown one and an editor', async () => {
		const { db, membersAreaId, occasionId, sender, storage } = await setUpAttachments();
		const { id } = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'a.pdf',
		});
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		await expect(removeAttachment(db, storage, editor, id)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(removeAttachment(db, storage, sender, 'x'.repeat(22))).rejects.toBeInstanceOf(
			AttachmentNotFoundError,
		);
		const waveId = await insertWave(db, occasionId);
		await db.update(attachments).set({ waveId }).where(eq(attachments.id, id));
		await expect(removeAttachment(db, storage, sender, id)).rejects.toBeInstanceOf(
			AttachmentLockedError,
		);
		await expect(storage.get(`attachments/${id}`)).resolves.not.toBeNull();
	});

	it('keeps the row when the object cannot be deleted, so the removal can be repeated', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const { id } = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'a.pdf',
		});
		const failing: ObjectStorage = {
			...storage,
			async delete(): Promise<void> {
				await Promise.reject(new Error('storage down'));
			},
		};
		await expect(removeAttachment(db, failing, sender, id)).rejects.toThrow('storage down');
		await expect(db.select({ id: attachments.id }).from(attachments)).resolves.toStrictEqual([
			{ id },
		]);
		await removeAttachment(db, storage, sender, id);
		await expect(db.select().from(attachments)).resolves.toStrictEqual([]);
	});
});

describe(deleteFreeAttachment, () => {
	it('deletes the object and the row of a file without a wave', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const { id } = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'a.pdf',
		});
		await expect(deleteFreeAttachment(db, storage, id)).resolves.toBe('deleted');
		await expect(storage.get(`attachments/${id}`)).resolves.toBeNull();
		await expect(deleteFreeAttachment(db, storage, id)).resolves.toBe('gone');
	});

	it('leaves a file that a wave holds, with its object', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const { id } = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'a.pdf',
		});
		const waveId = await insertWave(db, occasionId);
		await db.update(attachments).set({ waveId }).where(eq(attachments.id, id));
		await expect(deleteFreeAttachment(db, storage, id)).resolves.toBe('locked');
		await expect(storage.get(`attachments/${id}`)).resolves.not.toBeNull();
		await expect(db.select({ id: attachments.id }).from(attachments)).resolves.toStrictEqual([
			{ id },
		]);
	});
});

describe(readAttachments, () => {
	it('reads the bytes with the name and type of each record', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const record = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(30),
			name: 'Plan.pdf',
		});
		const read = await readAttachments(storage, [record]);
		expect(read).toHaveLength(1);
		expect(read[0]).toMatchObject({ contentType: 'application/pdf', filename: 'Plan.pdf' });
		expect(read[0]?.bytes).toHaveLength(30);
	});

	it('throws when an object is missing', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const record = await storeAttachment(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'a.pdf',
		});
		await storage.delete(`attachments/${record.id}`);
		await expect(readAttachments(storage, [record])).rejects.toBeInstanceOf(AttachmentMissingError);
	});
});
