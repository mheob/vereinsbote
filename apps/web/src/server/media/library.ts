/* oxlint-disable max-classes-per-file -- the typed refusals of the library live with it */
/*
 * The image library of an area (Design 15). Reading needs `read` in the area, every change
 * `edit`; the admin role alone gives neither. Brand images are not part of it.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { isForeignKeyViolation } from '@/server/db/errors';
import { media, templateMedia, templates } from '@/server/db/schema';
import { errorLabelWithCause } from '@/server/error-label';
import { assertArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import type { ObjectStorage } from '@/server/storage/storage';

import { mediaStorageKey } from './ids';
import { toRecord } from './media';
import type { MediaRecord } from './media';

const MAX_NAME_LENGTH = 200;

interface UsingTemplate {
	readonly id: string;
	readonly name: string;
}

/** A library image and the templates that show it. */
interface LibraryImage extends MediaRecord {
	readonly usedBy: readonly UsingTemplate[];
}

/** No library image has the id, e.g. it was deleted in another tab. */
class ImageNotFoundError extends Error {
	public constructor() {
		super('Unknown image.');
		this.name = 'ImageNotFoundError';
	}
}

/** The name is empty or longer than 200 characters after trimming. */
class ImageNameInvalidError extends Error {
	public constructor() {
		super('An image name has 1 to 200 characters after trimming.');
		this.name = 'ImageNameInvalidError';
	}
}

/** Templates show the image, so it cannot be deleted; `templates` names them. */
class ImageInUseError extends Error {
	public readonly templates: readonly UsingTemplate[];

	public constructor(using: readonly UsingTemplate[]) {
		super('A template uses this image.');
		this.name = 'ImageInUseError';
		this.templates = using;
	}
}

type Reader = Pick<Db, 'select'>;

async function usageOf(
	db: Reader,
	ids: readonly string[],
): Promise<ReadonlyMap<string, UsingTemplate[]>> {
	const usage = new Map<string, UsingTemplate[]>();
	if (ids.length === 0) return usage;
	const rows = await db
		.select({ id: templates.id, mediaId: templateMedia.mediaId, name: templates.name })
		.from(templateMedia)
		.innerJoin(templates, eq(templates.id, templateMedia.templateId))
		.where(inArray(templateMedia.mediaId, [...ids]))
		.orderBy(templates.name, templates.id);
	for (const { id, mediaId, name } of rows) {
		usage.set(mediaId, [...(usage.get(mediaId) ?? []), { id, name }]);
	}
	return usage;
}

/**
 * Finds a library image.
 *
 * @param db The database.
 * @param id The image.
 * @returns The row and the area it belongs to (a library image always has one).
 * @throws {ImageNotFoundError} For an unknown id or an image that is no library image.
 */
async function findLibraryImage(
	db: Reader,
	id: string,
): Promise<{ areaId: string; row: typeof media.$inferSelect }> {
	const [row] = await db
		.select()
		.from(media)
		.where(and(eq(media.id, id), eq(media.purpose, 'library')));
	if (row === undefined) throw new ImageNotFoundError();
	const { areaId } = row;
	if (areaId === null) throw new ImageNotFoundError();
	return { areaId, row };
}

/**
 * The images of an area's library, newest first, each with the templates that show it.
 *
 * @param db The database.
 * @param actor Who looks; needs `read` in the area.
 * @param areaId The area.
 * @returns The images.
 * @throws {ForbiddenError} Without `read` in the area.
 */
async function listLibrary(db: Db, actor: Principal, areaId: string): Promise<LibraryImage[]> {
	assertArea(actor, areaId, 'read');
	const rows = await db
		.select()
		.from(media)
		.where(and(eq(media.areaId, areaId), eq(media.purpose, 'library')))
		.orderBy(desc(media.createdAt), desc(media.id));
	const usage = await usageOf(
		db,
		rows.map(({ id }) => id),
	);
	return rows.map((row): LibraryImage => {
		const record: MediaRecord = toRecord(row);
		return Object.assign(record, { usedBy: usage.get(row.id) ?? [] });
	});
}

/**
 * Renames a library image. The name is stored trimmed.
 *
 * @param db The database.
 * @param actor Who renames; needs `edit` in the image's area.
 * @param id The image.
 * @param name The new name.
 * @throws {ImageNotFoundError} For an unknown image.
 * @throws {ForbiddenError} Without `edit` in the image's area.
 * @throws {ImageNameInvalidError} For an empty name or one over 200 characters.
 */
// oxlint-disable-next-line max-params -- the plan fixes this signature
async function renameImage(db: Db, actor: Principal, id: string, name: string): Promise<void> {
	const { areaId } = await findLibraryImage(db, id);
	assertArea(actor, areaId, 'edit');
	const trimmed = name.trim().toWellFormed();
	if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) throw new ImageNameInvalidError();
	await db.update(media).set({ name: trimmed }).where(eq(media.id, id));
}

/**
 * The transaction of `removeRow`.
 *
 * @param db The database.
 * @param id The image.
 * @param by Who deletes, and the image's area.
 * @param by.userId The acting user.
 * @param by.areaId The area.
 */
async function deleteRowChecked(
	db: Db,
	id: string,
	by: Readonly<{ userId: string; areaId: string }>,
): Promise<void> {
	await db.transaction(async (tx) => {
		const usage = await usageOf(tx, [id]);
		const using = usage.get(id) ?? [];
		if (using.length > 0) throw new ImageInUseError(using);
		const removed = await tx.delete(media).where(eq(media.id, id)).returning({ id: media.id });
		if (removed.length === 0) throw new ImageNotFoundError();
		await writeAudit(tx, {
			action: 'media.deleted',
			actorUserId: by.userId,
			details: { areaId: by.areaId },
			target: `media:${id}`,
		});
	});
}

/**
 * Deletes the row and writes the audit entry; refuses while a template shows the image.
 *
 * @param db The database.
 * @param id The image.
 * @param by Who deletes, and the area the image belongs to (for the audit entry).
 * @param by.userId The acting user.
 * @param by.areaId The area.
 */
async function removeRow(
	db: Db,
	id: string,
	by: Readonly<{ userId: string; areaId: string }>,
): Promise<void> {
	try {
		await deleteRowChecked(db, id, by);
	} catch (error) {
		// A template saved after the check: the foreign key refused the delete.
		if (!isForeignKeyViolation(error)) throw error;
		const using = await usageOf(db, [id]);
		throw new ImageInUseError(using.get(id) ?? []);
	}
}

/**
 * Deletes the stored object. When that fails the image is unreachable anyway (its row is gone),
 * so the failure is only logged, by its error code.
 *
 * @param storage The object storage.
 * @param id The image.
 */
async function removeObject(storage: ObjectStorage, id: string): Promise<void> {
	try {
		await storage.delete(mediaStorageKey(id));
	} catch (error) {
		console.error('image object not deleted', errorLabelWithCause(error));
	}
}

/**
 * Deletes a library image unless a template shows it: the row first (the foreign key from
 * `template_media` is the final guard), then the stored object. When the object cannot be
 * deleted the image is unreachable anyway; that is logged by its error code only.
 *
 * @param db The database.
 * @param storage The object storage.
 * @param actor Who deletes; needs `edit` in the image's area.
 * @param id The image.
 * @throws {ImageNotFoundError} For an unknown image.
 * @throws {ForbiddenError} Without `edit` in the image's area.
 * @throws {ImageInUseError} While a template shows the image.
 */
// oxlint-disable-next-line max-params -- the plan fixes this signature
async function deleteImage(
	db: Db,
	storage: ObjectStorage,
	actor: Principal,
	id: string,
): Promise<void> {
	const { areaId } = await findLibraryImage(db, id);
	assertArea(actor, areaId, 'edit');
	await removeRow(db, id, { areaId, userId: actor.userId });
	await removeObject(storage, id);
}

export {
	deleteImage,
	ImageInUseError,
	ImageNameInvalidError,
	ImageNotFoundError,
	listLibrary,
	renameImage,
};
export type { LibraryImage, UsingTemplate };
