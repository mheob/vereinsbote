import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { UnknownAreaError } from '@/server/contacts/errors';
import { setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { auditLog, media } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';
import type { ObjectStorage } from '@/server/storage/storage';

import { mediaFileName } from './ids';
import {
	InvalidImageError,
	MAX_IMAGE_BYTES,
	mediaResponse,
	openMedia,
	storeImage,
	uploadImageResult,
} from './media';
import type { MediaRecord } from './media';
import { pngBytes, withFailingTransactions } from './testing';

const BRAND = { purpose: 'brand' } as const;
const PNG_LENGTH = 100;

interface Club {
	readonly db: Db;
	readonly storage: ObjectStorage;
	readonly admin: Principal;
}

async function brandImage(club: Readonly<Club>, bytes: Uint8Array): Promise<MediaRecord> {
	return storeImage(club.db, club.storage, club.admin, BRAND, { bytes, name: 'a.png' });
}

describe(storeImage, () => {
	it('stores a library image for editors of the area', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		const record = await storeImage(
			db,
			storage,
			editor,
			{ areaId: membersAreaId, purpose: 'library' },
			{ bytes: pngBytes(600, 300, PNG_LENGTH), name: String.raw`C:\fakepath\Sommerfest.png` },
		);
		expect(record).toMatchObject({
			areaId: membersAreaId,
			bytes: PNG_LENGTH,
			height: 300,
			name: 'Sommerfest.png',
			purpose: 'library',
			type: 'png',
			width: 600,
		});
		expect(record.id).toMatch(/^[\w-]{22}$/u);
		await expect(storage.get(`media/${record.id}`)).resolves.toMatchObject({
			contentType: 'image/png',
			size: PNG_LENGTH,
		});
		const [row] = await db.select().from(media).where(eq(media.id, record.id));
		expect(row).toMatchObject({ createdByUserId: editor.userId });
	});

	it('writes the audit entry with ids only', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		const record = await storeImage(
			db,
			createMemoryStorage(),
			editor,
			{ areaId: membersAreaId, purpose: 'library' },
			{ bytes: pngBytes(10, 10), name: 'geheim.png' },
		);
		const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'media.uploaded'));
		expect(entry).toMatchObject({
			actorUserId: editor.userId,
			details: { areaId: membersAreaId, purpose: 'library' },
			target: `media:${record.id}`,
		});
	});

	it('stores a brand image for admins and cuts the name to 200 characters', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const record = await storeImage(db, createMemoryStorage(), admin, BRAND, {
			bytes: pngBytes(10, 10),
			name: `${'a'.repeat(300)}.png`,
		});
		expect(record).toMatchObject({ areaId: null, purpose: 'brand' });
		expect(record.name).toHaveLength(200);
	});

	it('refuses readers and other areas for library images', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		const elsewhere = await userWith(db, { [partnersAreaId]: 'send' });
		const file = { bytes: pngBytes(10, 10), name: 'a.png' };
		const library = { areaId: membersAreaId, purpose: 'library' } as const;
		await expect(storeImage(db, storage, reader, library, file)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(storeImage(db, storage, elsewhere, library, file)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(db.select().from(media)).resolves.toHaveLength(0);
	});

	it('refuses non-admins for brand images, an area editor included', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'send' });
		await expect(
			storeImage(db, createMemoryStorage(), editor, BRAND, {
				bytes: pngBytes(10, 10),
				name: 'a.png',
			}),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it('refuses an unknown area', async () => {
		const db = await createTestDb();
		const areaId = randomUUID();
		const stale: Principal = {
			areas: new Map([[areaId, 'edit']]),
			isAdmin: false,
			userId: randomUUID(),
		};
		await expect(
			storeImage(
				db,
				createMemoryStorage(),
				stale,
				{ areaId, purpose: 'library' },
				{ bytes: pngBytes(1, 1), name: 'a.png' },
			),
		).rejects.toBeInstanceOf(UnknownAreaError);
	});

	it('refuses what is no JPEG or PNG, whatever its name says', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const html = new TextEncoder().encode('<script>alert(1)</script>');
		await expect(
			brandImage({ admin, db, storage: createMemoryStorage() }, html),
		).rejects.toBeInstanceOf(InvalidImageError);
		await expect(db.select().from(media)).resolves.toHaveLength(0);
	});

	it.each([
		[1201, 100],
		[1, 10_000],
		[1, 4001],
		[0, 10],
	])('refuses %d×%d pixels', async (width, height) => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await expect(
			brandImage({ admin, db, storage: createMemoryStorage() }, pngBytes(width, height)),
		).rejects.toBeInstanceOf(InvalidImageError);
	});

	it('accepts the largest size', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const record = await brandImage(
			{ admin, db, storage: createMemoryStorage() },
			pngBytes(1200, 4000),
		);
		expect(record).toMatchObject({ height: 4000, width: 1200 });
	});

	it('refuses more than 2 MB and accepts exactly 2 MB', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { admin } = await setUpClub(db);
		await expect(
			brandImage({ admin, db, storage }, pngBytes(10, 10, MAX_IMAGE_BYTES + 1)),
		).rejects.toBeInstanceOf(InvalidImageError);
		await expect(
			brandImage({ admin, db, storage }, pngBytes(10, 10, MAX_IMAGE_BYTES)),
		).resolves.toMatchObject({ bytes: MAX_IMAGE_BYTES });
	});

	it('removes the object when the row cannot be written', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const memory = createMemoryStorage();
		const keys: string[] = [];
		const storage: ObjectStorage = {
			...memory,
			async put(key, bytes, options) {
				keys.push(key);
				await memory.put(key, bytes, options);
			},
		};
		const broken = withFailingTransactions(db);
		await expect(brandImage({ admin, db: broken, storage }, pngBytes(10, 10))).rejects.toThrow(
			'write failed',
		);
		expect(keys).toHaveLength(1);
		await expect(memory.get(keys.join(','))).resolves.toBeNull();
		await expect(db.select().from(media)).resolves.toHaveLength(0);
	});
});

describe(uploadImageResult, () => {
	it('answers an image, and the expected refusals as results', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { admin } = await setUpClub(db);
		const file = { bytes: pngBytes(10, 10), name: 'a.png' };
		await expect(uploadImageResult(db, storage, admin, BRAND, file)).resolves.toMatchObject({
			media: { purpose: 'brand' },
			ok: true,
		});
		await expect(
			uploadImageResult(db, storage, admin, BRAND, { bytes: new Uint8Array(3), name: 'a.png' }),
		).resolves.toStrictEqual({ failure: 'invalidImage', ok: false });
		await expect(uploadImageResult(db, null, admin, BRAND, file)).resolves.toStrictEqual({
			failure: 'storageMissing',
			ok: false,
		});
	});

	it('answers gone for a deleted area and still throws for a missing right', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { membersAreaId } = await setUpClub(db);
		const file = { bytes: pngBytes(10, 10), name: 'a.png' };
		const areaId = randomUUID();
		const stale: Principal = {
			areas: new Map([[areaId, 'edit']]),
			isAdmin: false,
			userId: randomUUID(),
		};
		await expect(
			uploadImageResult(db, storage, stale, { areaId, purpose: 'library' }, file),
		).resolves.toStrictEqual({ failure: 'gone', ok: false });
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		await expect(
			uploadImageResult(db, storage, reader, { areaId: membersAreaId, purpose: 'library' }, file),
		).rejects.toBeInstanceOf(ForbiddenError);
	});
});

describe(mediaResponse, () => {
	it('serves an image with cache and sandbox headers', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { admin } = await setUpClub(db);
		const bytes = pngBytes(40, 30, PNG_LENGTH);
		const record = await brandImage({ admin, db, storage }, bytes);
		const found = await openMedia(db, storage, mediaFileName(record.id, 'png'));
		const response = mediaResponse(found, 'GET', 'node');
		expect(response.status).toBe(200);
		expect(Object.fromEntries(response.headers)).toMatchObject({
			'cache-control': 'public, max-age=86400',
			'content-disposition': 'inline',
			'content-length': String(PNG_LENGTH),
			'content-security-policy': "default-src 'none'; sandbox",
			'content-type': 'image/png',
			'cross-origin-resource-policy': 'cross-origin',
			'x-content-type-options': 'nosniff',
		});
		expect(response.headers.has('cdn-cache-control')).toBe(false);
		await expect(response.bytes()).resolves.toStrictEqual(bytes);
	});

	it('adds the CDN cache header on Vercel only', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { admin } = await setUpClub(db);
		const record = await brandImage({ admin, db, storage }, pngBytes(4, 4));
		const file = mediaFileName(record.id, 'png');
		const vercel = mediaResponse(await openMedia(db, storage, file), 'GET', 'vercel');
		const cloudflare = mediaResponse(await openMedia(db, storage, file), 'GET', 'cloudflare');
		expect(vercel.headers.get('cdn-cache-control')).toBe('public, max-age=86400');
		expect(cloudflare.headers.has('cdn-cache-control')).toBe(false);
	});

	it('answers HEAD with the headers and no body', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { admin } = await setUpClub(db);
		const record = await brandImage({ admin, db, storage }, pngBytes(4, 4, PNG_LENGTH));
		const found = await openMedia(db, storage, mediaFileName(record.id, 'png'));
		const response = mediaResponse(found, 'HEAD', 'node');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-length')).toBe(String(PNG_LENGTH));
		expect(response.body).toBeNull();
	});

	it('answers nothing for an unknown file', async () => {
		const response = mediaResponse(null, 'GET', 'node');
		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe('');
	});
});

describe(openMedia, () => {
	it('finds nothing for unknown ids, the wrong extension or a bad name', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { admin } = await setUpClub(db);
		const record = await brandImage({ admin, db, storage }, pngBytes(5, 5));
		await expect(openMedia(db, storage, mediaFileName(record.id, 'jpeg'))).resolves.toBeNull();
		await expect(openMedia(db, storage, 'nonsense.png')).resolves.toBeNull();
		const unknown = mediaFileName('A'.repeat(22), 'png');
		await expect(openMedia(db, storage, unknown)).resolves.toBeNull();
	});

	it('finds nothing when the object is gone', async () => {
		const db = await createTestDb();
		const storage = createMemoryStorage();
		const { admin } = await setUpClub(db);
		const record = await brandImage({ admin, db, storage }, pngBytes(5, 5));
		await storage.delete(`media/${record.id}`);
		await expect(openMedia(db, storage, mediaFileName(record.id, 'png'))).resolves.toBeNull();
	});
});
