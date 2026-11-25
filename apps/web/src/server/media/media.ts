import { eq } from 'drizzle-orm';

import type { PlatformName } from '@/platform/platform';
import { securityHeadersFor } from '@/platform/security-headers';
import { writeAudit } from '@/server/audit/audit';
import { UnknownAreaError } from '@/server/contacts/errors';
import type { Db } from '@/server/db/client';
import { areas, media } from '@/server/db/schema';
import { assertAdmin, assertArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { StorageNotConfiguredError } from '@/server/storage/storage';
import type { ObjectStorage, StoredObject } from '@/server/storage/storage';

import { mediaStorageKey, newMediaId, parseMediaFileName } from './ids';
import type { ImageType } from './ids';
import { readImageHeader } from './image-header';
import type { ImageHeader } from './image-header';
import { MAX_IMAGE_BYTES, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH } from './limits';

const MAX_NAME_LENGTH = 200;
/** One day, in seconds (plan decision 7). */
const CACHE_CONTROL = 'public, max-age=86400';

const CONTENT_TYPES: Readonly<Record<ImageType, string>> = {
	jpeg: 'image/jpeg',
	png: 'image/png',
};

type MediaPurpose = 'brand' | 'library';

interface MediaRecord {
	id: string;
	purpose: MediaPurpose;
	areaId: string | null;
	type: ImageType;
	width: number;
	height: number;
	bytes: number;
	name: string;
	createdAt: Date;
}

/** The file is no JPEG or PNG, or too large in bytes or pixels. The message names nothing. */
class InvalidImageError extends Error {
	public constructor() {
		super('The file is not an acceptable image.');
		this.name = 'InvalidImageError';
	}
}

type MediaTarget = Readonly<{ purpose: 'brand' } | { purpose: 'library'; areaId: string }>;

/** What the upload form gets back: the image, or why it was refused. */
type UploadImageResult =
	| Readonly<{ ok: true; media: MediaRecord }>
	| Readonly<{ ok: false; failure: 'invalidImage' | 'storageMissing' | 'gone' }>;

function toRecord(row: Readonly<typeof media.$inferSelect>): MediaRecord {
	const { areaId, bytes, createdAt, height, id, name, purpose, type, width } = row;
	return { areaId, bytes, createdAt, height, id, name, purpose, type, width };
}

/**
 * Reduces what a browser reports to a plain file name: the last path segment, without control
 * characters, at most 200 characters, valid Unicode (PostgreSQL refuses a lone surrogate).
 *
 * @param name The reported name.
 * @returns The name.
 */
function cleanName(name: string): string {
	const base = name.split(/[/\\]/u).pop() ?? '';
	// oxlint-disable-next-line no-control-regex -- removing the control characters is the point
	const printable = base.replaceAll(/[\u0000-\u001F\u007F]/gu, '').trim();
	return printable.slice(0, MAX_NAME_LENGTH).toWellFormed();
}

async function assertTarget(db: Db, actor: Principal, target: MediaTarget): Promise<void> {
	if (target.purpose === 'brand') {
		assertAdmin(actor);
		return;
	}
	assertArea(actor, target.areaId, 'edit');
	const [area] = await db.select({ id: areas.id }).from(areas).where(eq(areas.id, target.areaId));
	if (area === undefined) throw new UnknownAreaError();
}

function checkedHeader(bytes: Uint8Array): ImageHeader {
	const header = bytes.byteLength > MAX_IMAGE_BYTES ? null : readImageHeader(bytes);
	if (header === null || header.width > MAX_IMAGE_WIDTH || header.height > MAX_IMAGE_HEIGHT) {
		throw new InvalidImageError();
	}
	return header;
}

interface NewImage {
	readonly id: string;
	readonly header: Readonly<ImageHeader>;
	readonly name: string;
	readonly size: number;
	readonly userId: string;
}

async function recordImage(
	db: Db,
	target: MediaTarget,
	image: Readonly<NewImage>,
): Promise<MediaRecord> {
	const { header, id, name, size, userId } = image;
	const areaId = target.purpose === 'library' ? target.areaId : null;
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(media)
			.values({
				areaId,
				bytes: size,
				createdByUserId: userId,
				height: header.height,
				id,
				name: cleanName(name),
				purpose: target.purpose,
				type: header.type,
				width: header.width,
			})
			.returning();
		if (row === undefined) throw new Error('Inserting the image returned no row.');
		await writeAudit(tx, {
			action: 'media.uploaded',
			actorUserId: userId,
			details: { areaId, purpose: target.purpose },
			target: `media:${id}`,
		});
		return toRecord(row);
	});
}

/**
 * Stores an uploaded image. Type and size come from the file's own header, never from its name.
 * The object is written first, then the row and the audit entry in one transaction; when that
 * fails the object is deleted again.
 *
 * @param db The database.
 * @param storage The object storage.
 * @param actor Who uploads: an admin for `brand`, an editor of the area for `library`.
 * @param target A brand image, or a library image of an area.
 * @param file The file's name (reduced to a plain name) and bytes.
 * @param file.name The name the browser reported.
 * @param file.bytes The content.
 * @returns The stored image.
 * @throws {ForbiddenError} Without the right for the target.
 * @throws {UnknownAreaError} For an area that does not exist (any more).
 * @throws {InvalidImageError} For anything but a JPEG or PNG of at most 1200 x 4000 px and 2 MB.
 */
// oxlint-disable-next-line max-params -- the plan fixes this signature
async function storeImage(
	db: Db,
	storage: ObjectStorage,
	actor: Principal,
	target: MediaTarget,
	file: Readonly<{ name: string; bytes: Uint8Array }>,
): Promise<MediaRecord> {
	await assertTarget(db, actor, target);
	const header = checkedHeader(file.bytes);
	const id = newMediaId();
	await storage.put(mediaStorageKey(id), file.bytes, { contentType: CONTENT_TYPES[header.type] });
	try {
		const { bytes, name } = file;
		return await recordImage(db, target, {
			header,
			id,
			name,
			size: bytes.byteLength,
			userId: actor.userId,
		});
	} catch (error) {
		await storage.delete(mediaStorageKey(id));
		throw error;
	}
}

/**
 * Stores an upload and turns the expected refusals into results. A missing right still throws
 * `ForbiddenError`, as in every server function.
 *
 * @param db The database.
 * @param storage The object storage, null when none is set up.
 * @param actor Who uploads.
 * @param target A brand image, or a library image of an area.
 * @param file The file's name and bytes.
 * @returns The image, or why it was refused.
 */
// oxlint-disable-next-line max-params -- the same parameters as `storeImage`
async function uploadImageResult(
	db: Db,
	storage: ObjectStorage | null,
	actor: Principal,
	target: MediaTarget,
	file: Readonly<{ name: string; bytes: Uint8Array }>,
): Promise<UploadImageResult> {
	if (storage === null) return { failure: 'storageMissing', ok: false };
	try {
		return { media: await storeImage(db, storage, actor, target, file), ok: true };
	} catch (error) {
		if (error instanceof InvalidImageError) return { failure: 'invalidImage', ok: false };
		if (error instanceof UnknownAreaError) return { failure: 'gone', ok: false };
		if (error instanceof StorageNotConfiguredError) return { failure: 'storageMissing', ok: false };
		throw error;
	}
}

/**
 * Looks an image up by the file name of its URL.
 *
 * @param db The database.
 * @param storage The object storage.
 * @param file The last path segment of `/media/<file>`.
 * @returns The record and the stored object, or null for a malformed name, an unknown id, a
 *   wrong extension or a missing object.
 */
async function openMedia(
	db: Db,
	storage: ObjectStorage,
	file: string,
): Promise<{ record: MediaRecord; object: StoredObject } | null> {
	const parsed = parseMediaFileName(file);
	if (parsed === null) return null;
	const [row] = await db.select().from(media).where(eq(media.id, parsed.id));
	if (row?.type !== parsed.type) return null;
	const object = await storage.get(mediaStorageKey(row.id));
	return object === null ? null : { object, record: toRecord(row) };
}

function imageHeaders(type: ImageType, size: number, platform: PlatformName): Headers {
	const headers = new Headers(securityHeadersFor('media', { https: false, nonce: '' }));
	headers.set('content-type', CONTENT_TYPES[type]);
	headers.set('content-length', String(size));
	headers.set('cache-control', CACHE_CONTROL);
	headers.set('content-disposition', 'inline');
	if (platform === 'vercel') headers.set('cdn-cache-control', CACHE_CONTROL);
	return headers;
}

/**
 * The response of a `/media` request. It sets the security headers of the images itself, so it
 * is safe whatever middleware runs around it.
 *
 * @param found What `openMedia` found.
 * @param method The request method.
 * @param platform The deploy target; Vercel's CDN gets its own cache header.
 * @returns The image, or 404 with an empty body.
 */
function mediaResponse(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the object holds a stream
	found: Awaited<ReturnType<typeof openMedia>>,
	method: 'GET' | 'HEAD',
	platform: PlatformName,
): Response {
	if (found === null) return new Response(null, { status: 404 });
	const headers = imageHeaders(found.record.type, found.object.size, platform);
	if (method === 'GET') return new Response(found.object.body, { headers });
	// A HEAD answer has no body: let the storage connection go.
	// oxlint-disable-next-line no-void, promise/prefer-await-to-then, unicorn/no-useless-undefined -- nothing waits for the cancel, and it must not reject unhandled
	void found.object.body.cancel().catch(() => undefined);
	return new Response(null, { headers });
}

export { InvalidImageError, mediaResponse, openMedia, storeImage, toRecord, uploadImageResult };
export type { MediaPurpose, MediaRecord, UploadImageResult };
