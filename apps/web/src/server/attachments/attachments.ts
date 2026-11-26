import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { attachments, occasions } from '@/server/db/schema';
import { errorLabel } from '@/server/error-label';
import { newMediaId } from '@/server/media/ids';
import { OccasionInvalidError, OccasionNotFoundError } from '@/server/occasions/errors';
import { getOccasion } from '@/server/occasions/occasions';
import { assertArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import type { AttachmentType, MailAttachment } from '@/server/sending/transport';
import type { ObjectStorage } from '@/server/storage/storage';

import {
	AttachmentInvalidError,
	AttachmentLockedError,
	AttachmentMissingError,
	AttachmentNotFoundError,
} from './errors';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENTS_TOTAL } from './limits';
import { safeFileName, sniffAttachmentType } from './signature';

interface AttachmentRecord {
	id: string;
	areaId: string;
	/** Null while the file belongs to the occasion's open flow. */
	waveId: string | null;
	name: string;
	type: AttachmentType;
	size: number;
}

/** A file an occasion holds for its next wave, as the send flow lists it to one user. */
interface FreeAttachment extends AttachmentRecord {
	/** Whether that user uploaded it: the flow chooses only such files at first. */
	own: boolean;
}

/**
 * The key of an attachment in the object storage.
 *
 * @param id The id of the attachment.
 * @returns `attachments/<id>`.
 */
function attachmentStorageKey(id: string): string {
	return `attachments/${id}`;
}

function toRecord(row: Readonly<typeof attachments.$inferSelect>): AttachmentRecord {
	const { areaId, id, name, size, type, waveId } = row;
	return { areaId, id, name, size, type, waveId };
}

/**
 * The files an occasion holds for its next wave, each marked whether a user uploaded it; a file of
 * a flow left unconfirmed or of a colleague's flow is not that user's (M-2). Names no user.
 *
 * @param db The database.
 * @param occasionId The occasion.
 * @param userId The user who looks.
 * @returns The files, oldest first.
 */
async function freeAttachmentsOf(
	db: Db,
	occasionId: string,
	userId: string,
): Promise<FreeAttachment[]> {
	const rows = await db
		.select()
		.from(attachments)
		.where(and(eq(attachments.occasionId, occasionId), isNull(attachments.waveId)))
		.orderBy(asc(attachments.createdAt), asc(attachments.id));
	return rows.map((row) => Object.assign(toRecord(row), { own: row.createdByUserId === userId }));
}

/**
 * Checks the open attachments of an occasion together with a new file.
 *
 * @param count How many files are open.
 * @param total How many bytes they hold.
 * @param size The size of the new file.
 * @throws {AttachmentInvalidError} When there would be too many files or bytes (`count`, `total`).
 */
function checkRoom(count: number, total: number, size: number): void {
	if (count >= MAX_ATTACHMENTS) throw new AttachmentInvalidError('count');
	if (total + size > MAX_ATTACHMENTS_TOTAL) throw new AttachmentInvalidError('total');
}

/**
 * Checks the count and the sum of the open attachments of the occasion together with the new one.
 * The occasion row is locked first, so two uploads at once cannot both pass, and an occasion
 * archived meanwhile takes no file.
 *
 * @param tx The transaction.
 * @param occasionId The occasion.
 * @param size The size of the new file.
 * @throws {OccasionNotFoundError} When the occasion is gone.
 * @throws {OccasionInvalidError} When the occasion is archived (`archived`).
 * @throws {AttachmentInvalidError} When there would be too many files or bytes (`count`, `total`).
 */
async function assertRoom(tx: Db, occasionId: string, size: number): Promise<void> {
	const [locked] = await tx
		.select({ archivedAt: occasions.archivedAt })
		.from(occasions)
		.where(eq(occasions.id, occasionId))
		.for('update');
	if (locked === undefined) throw new OccasionNotFoundError();
	if (locked.archivedAt !== null) throw new OccasionInvalidError('archived');
	const [open] = await tx
		.select({
			count: sql<number>`count(*)::int`,
			total: sql<number>`coalesce(sum(${attachments.size}), 0)::int`,
		})
		.from(attachments)
		.where(and(eq(attachments.occasionId, occasionId), isNull(attachments.waveId)));
	checkRoom(open?.count ?? 0, open?.total ?? 0, size);
}

/**
 * The type of a file that may be attached.
 *
 * @param bytes The content.
 * @returns The sniffed type.
 * @throws {AttachmentInvalidError} For a file over 4 MiB (`size`) or no PDF, JPEG or PNG (`type`).
 */
function checkedType(bytes: Uint8Array): AttachmentType {
	if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentInvalidError('size');
	const type = sniffAttachmentType(bytes);
	if (type === null) throw new AttachmentInvalidError('type');
	return type;
}

/**
 * The area of an occasion that may take files for its next wave.
 *
 * @param db The database.
 * @param actor Who uploads; needs `send` in the area.
 * @param occasionId The occasion.
 * @returns The area.
 * @throws {OccasionNotFoundError} When the occasion is gone.
 * @throws {ForbiddenError} Without `send` in the area.
 * @throws {OccasionInvalidError} When the occasion is archived (`archived`): it sends no wave.
 */
async function sendingArea(db: Db, actor: Principal, occasionId: string): Promise<string> {
	const { archivedAt, areaId } = await getOccasion(db, actor, occasionId);
	assertArea(actor, areaId, 'send');
	if (archivedAt !== null) throw new OccasionInvalidError('archived');
	return areaId;
}

/**
 * Deletes the object of a file whose row was never written. A failure is logged by its label and
 * swallowed, so the caller's own error goes on.
 *
 * @param storage The object storage.
 * @param id The attachment.
 */
async function deleteStoredObject(storage: ObjectStorage, id: string): Promise<void> {
	try {
		await storage.delete(attachmentStorageKey(id));
	} catch (cleanupError) {
		// oxlint-disable-next-line no-console -- the label only: the message may name the key
		console.error('attachment object not deleted', errorLabel(cleanupError));
	}
}

/**
 * Stores a file for the next wave of an occasion. Type and size come from the file itself, never
 * from its name. The object is written first, then the row; when that fails the object is deleted
 * again (should that fail too, the refusal goes on and the failed deletion is logged). Attachments without a wave count against the limits (5 files, 20 MiB together).
 *
 * @param db The database.
 * @param storage The object storage.
 * @param actor Who uploads; needs `send` in the occasion's area.
 * @param occasionId The occasion.
 * @param file The file's name (made safe) and bytes.
 * @param file.name The name the browser reported.
 * @param file.bytes The content.
 * @returns The stored attachment.
 * @throws {OccasionNotFoundError} When the occasion is gone.
 * @throws {ForbiddenError} Without `send` in the area.
 * @throws {OccasionInvalidError} When the occasion is archived (`archived`): it sends no wave.
 * @throws {AttachmentInvalidError} For anything but a PDF, JPEG or PNG of at most 4 MiB, or when
 *   the mail would have too many files or bytes.
 */
// oxlint-disable-next-line max-params -- the plan fixes this signature
async function storeAttachment(
	db: Db,
	storage: ObjectStorage,
	actor: Principal,
	occasionId: string,
	file: Readonly<{ name: string; bytes: Uint8Array }>,
): Promise<AttachmentRecord> {
	const areaId = await sendingArea(db, actor, occasionId);
	const { bytes } = file;
	const type = checkedType(bytes);
	const id = newMediaId();
	await storage.put(attachmentStorageKey(id), bytes, { contentType: type });
	try {
		return await db.transaction(async (tx) => {
			await assertRoom(tx, occasionId, bytes.byteLength);
			const [row] = await tx
				.insert(attachments)
				.values({
					areaId,
					createdByUserId: actor.userId,
					id,
					name: safeFileName(file.name, type),
					occasionId,
					size: bytes.byteLength,
					type,
				})
				.returning();
			if (row === undefined) throw new Error('Inserting the attachment returned no row.');
			return toRecord(row);
		});
	} catch (error) {
		await deleteStoredObject(storage, id);
		throw error;
	}
}

/**
 * Deletes an attachment that no wave holds, the only way its object is deleted: inside a
 * transaction it locks the row (`for update`), deletes the object, then the row. `confirmWave`
 * locks the rows it links the same way, so it waits for a deletion and then finds the file gone:
 * a wave never holds a file without its object. When the storage fails, the transaction rolls back
 * and the row stays, so the deletion can be repeated.
 *
 * @param db The database.
 * @param storage The object storage.
 * @param id The attachment.
 * @returns `deleted`; `gone` when no row has the id; `locked` when a wave holds it (nothing is
 *   deleted).
 */
async function deleteFreeAttachment(
	db: Db,
	storage: ObjectStorage,
	id: string,
): Promise<'deleted' | 'gone' | 'locked'> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ waveId: attachments.waveId })
			.from(attachments)
			.where(eq(attachments.id, id))
			.for('update');
		if (row === undefined) return 'gone';
		if (row.waveId !== null) return 'locked';
		await storage.delete(attachmentStorageKey(id));
		await tx.delete(attachments).where(eq(attachments.id, id));
		return 'deleted';
	});
}

/**
 * Removes an attachment that has no wave yet (`deleteFreeAttachment`).
 *
 * @param db The database.
 * @param storage The object storage.
 * @param actor Who removes; needs `send` in the attachment's area.
 * @param id The attachment.
 * @throws {AttachmentNotFoundError} When no attachment has the id.
 * @throws {ForbiddenError} Without `send` in the area.
 * @throws {AttachmentLockedError} When the attachment hangs at a wave.
 */
// oxlint-disable-next-line max-params -- the plan fixes this signature
async function removeAttachment(
	db: Db,
	storage: ObjectStorage,
	actor: Principal,
	id: string,
): Promise<void> {
	const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
	if (row === undefined) throw new AttachmentNotFoundError();
	assertArea(actor, row.areaId, 'send');
	if (row.waveId !== null) throw new AttachmentLockedError();
	// A wave may take the file, or the cleanup remove it, between the check and the lock.
	const deletion = await deleteFreeAttachment(db, storage, id);
	if (deletion === 'gone') throw new AttachmentNotFoundError();
	if (deletion === 'locked') throw new AttachmentLockedError();
}

/**
 * Reads the stored files of attachments into the bytes a mail carries.
 *
 * @param storage The object storage.
 * @param records The attachments, in the order the mail lists them.
 * @returns One mail attachment per record, in the same order.
 * @throws {AttachmentMissingError} When a stored object is missing.
 */
async function readAttachments(
	storage: ObjectStorage,
	records: readonly Readonly<AttachmentRecord>[],
): Promise<MailAttachment[]> {
	return Promise.all(
		records.map(async ({ id, name, type }) => {
			const object = await storage.get(attachmentStorageKey(id));
			if (object === null) throw new AttachmentMissingError();
			const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
			return { bytes, contentType: type, filename: name };
		}),
	);
}

export {
	attachmentStorageKey,
	checkRoom,
	deleteFreeAttachment,
	freeAttachmentsOf,
	readAttachments,
	removeAttachment,
	storeAttachment,
	toRecord,
};
export {
	AttachmentInvalidError,
	AttachmentLockedError,
	AttachmentMissingError,
	AttachmentNotFoundError,
} from './errors';
export {
	ATTACHMENT_TYPES,
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENTS,
	MAX_ATTACHMENTS_TOTAL,
} from './limits';
export type { AttachmentRecord, FreeAttachment };
