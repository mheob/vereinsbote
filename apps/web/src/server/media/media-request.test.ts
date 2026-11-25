import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { setUpClub } from '@/server/contacts/testing';
import { createTestDb } from '@/server/db/test-db';
import { createMemoryStorage } from '@/server/storage/memory';
import type { ObjectStorage } from '@/server/storage/storage';

import { mediaFileName } from './ids';
import { storeImage } from './media';
import { handleMediaRequest } from './media-request';
import type { MediaServices } from './media-request';
import { pngBytes } from './testing';

const MEDIA_HEADERS = {
	'cache-control': 'no-store',
	'content-security-policy': "default-src 'none'; sandbox",
	'cross-origin-resource-policy': 'cross-origin',
	'x-content-type-options': 'nosniff',
};

/**
 * A failure as the database driver reports it: a code, and a message with connection details.
 *
 * @returns The error.
 */
function connectionError(): Error {
	return Object.assign(new Error('connect to postgres://user:secret@db.example failed'), {
		code: 'ECONNREFUSED',
	});
}

/**
 * The services of a club with one stored brand image.
 *
 * @param storage The storage, the memory one by default.
 * @returns The services and the file name of the image.
 */
async function clubWithImage(
	storage: ObjectStorage = createMemoryStorage(),
): Promise<{ services: MediaServices; file: string }> {
	const db = await createTestDb();
	const { admin } = await setUpClub(db);
	const record = await storeImage(
		db,
		storage,
		admin,
		{ purpose: 'brand' },
		{
			bytes: pngBytes(4, 4),
			name: 'logo.png',
		},
	);
	return { file: mediaFileName(record.id, 'png'), services: { db, platform: 'node', storage } };
}

/**
 * Opens the given services, as the route does per request.
 *
 * @param services The services.
 * @returns The function the handler calls.
 */
function servicesOf(services: MediaServices): () => Promise<MediaServices> {
	return vi.fn<() => Promise<MediaServices>>().mockResolvedValue(services);
}

/**
 * A request for an image.
 *
 * @param method The method.
 * @returns The request.
 */
function request(method: string): Request {
	return new Request('https://verein.example/media/x.png', { method });
}

describe(handleMediaRequest, () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('serves a stored image for GET and HEAD', async () => {
		const { file, services } = await clubWithImage();
		const get = await handleMediaRequest(request('GET'), file, servicesOf(services));
		expect(get.status).toBe(200);
		expect(get.headers.get('content-type')).toBe('image/png');
		const head = await handleMediaRequest(request('HEAD'), file, servicesOf(services));
		expect(head.status).toBe(200);
		expect(head.body).toBeNull();
	});

	it('answers 404 for an unknown file and when no storage is set up', async () => {
		const { services } = await clubWithImage();
		const unknown = mediaFileName('A'.repeat(22), 'png');
		const missing = await handleMediaRequest(request('GET'), unknown, servicesOf(services));
		expect(missing.status).toBe(404);
		const { file } = await clubWithImage();
		const noStorage = await handleMediaRequest(
			request('GET'),
			file,
			servicesOf({ ...services, storage: null }),
		);
		expect(noStorage.status).toBe(404);
	});

	it('refuses other methods with 405 and the image headers, without opening anything', async () => {
		const services = vi.fn<() => Promise<MediaServices>>();
		const response = await handleMediaRequest(request('POST'), 'x.png', services);
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET, HEAD');
		expect(Object.fromEntries(response.headers)).toMatchObject(MEDIA_HEADERS);
		expect(services).not.toHaveBeenCalled();
	});

	it('answers 503 with the image headers when the database fails, and logs the code only', async () => {
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const response = await handleMediaRequest(
			request('GET'),
			'x.png',
			vi.fn<() => Promise<MediaServices>>().mockRejectedValue(connectionError()),
		);
		expect(response.status).toBe(503);
		await expect(response.text()).resolves.toBe('');
		expect(Object.fromEntries(response.headers)).toMatchObject(MEDIA_HEADERS);
		expect(log).toHaveBeenCalledExactlyOnceWith('media request failed', 'ECONNREFUSED');
	});

	it('answers 503 when the storage fails', async () => {
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const memory = createMemoryStorage();
		const { file, services } = await clubWithImage(memory);
		const failing: ObjectStorage = {
			...memory,
			get: vi.fn<ObjectStorage['get']>().mockRejectedValue(new Error('storage down')),
		};
		const response = await handleMediaRequest(
			request('GET'),
			file,
			servicesOf({ ...services, storage: failing }),
		);
		expect(response.status).toBe(503);
		expect(log).toHaveBeenCalledExactlyOnceWith('media request failed', 'Error');
	});
});
