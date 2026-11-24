import { describe, expect, it } from 'vite-plus/test';

import type { ObjectStorage } from './storage';
import { StorageError } from './storage-error';

// Four bytes; the storage does not look inside.
const BYTES = new TextEncoder().encode('data');

/**
 * Reads a stored object's body to the end.
 *
 * @param body The stream of the object.
 * @returns The bytes.
 */
async function readAll(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	return new Uint8Array(await new Response(body).arrayBuffer());
}

/**
 * The cases every implementation of `ObjectStorage` must pass, so the in-memory double that the
 * other tests use behaves like R2, Vercel Blob and S3.
 *
 * @param name The implementation's name, the title of the suite.
 * @param open Opens an empty storage, called once per case.
 */
function describeStorageContract(name: string, open: () => Promise<ObjectStorage>): void {
	describe(`${name} as object storage`, () => {
		it('stores and reads bytes with their type', async () => {
			const storage = await open();
			const key = `contract/${crypto.randomUUID()}`;
			await storage.put(key, BYTES, { contentType: 'image/png' });
			const stored = await storage.get(key);
			expect(stored?.contentType).toBe('image/png');
			expect(stored?.size).toBe(4);
			expect(stored === null ? null : await readAll(stored.body)).toStrictEqual(BYTES);
			await storage.delete(key);
		});

		it('returns null for a missing key', async () => {
			const storage = await open();
			expect(await storage.get(`contract/${crypto.randomUUID()}`)).toBeNull();
		});

		it('deletes, and deleting twice is fine', async () => {
			const storage = await open();
			const key = `contract/${crypto.randomUUID()}`;
			await storage.put(key, BYTES, { contentType: 'image/png' });
			await storage.delete(key);
			await storage.delete(key);
			expect(await storage.get(key)).toBeNull();
		});
	});
}

// Expects a request to fail as a `StorageError` whose message names the operation only.
const expectStorageFailure = async (call: Promise<unknown>): Promise<void> => {
	await expect(call).rejects.toBeInstanceOf(StorageError);
	await expect(call).rejects.toThrow(/^Object storage request failed \((?:delete|get|put)\)\.$/u);
};

const KEY = 'media/secret';

/**
 * Expects every operation of a storage whose backend always fails to fail as a `StorageError`
 * with a message free of the key, values and credentials.
 *
 * @param storage The storage over a failing backend.
 */
async function expectStorageFailures(storage: ObjectStorage): Promise<void> {
	await Promise.all([
		expectStorageFailure(storage.put(KEY, BYTES, { contentType: 'image/png' })),
		expectStorageFailure(storage.get(KEY)),
		expectStorageFailure(storage.delete(KEY)),
	]);
}

// A storage that is ready at once, for the `open` of a suite whose storage needs no setup.
// oxlint-disable-next-line typescript/require-await -- adapts a ready storage to the async `open`
const readyStorage = async (storage: ObjectStorage): Promise<ObjectStorage> => storage;

export { describeStorageContract, expectStorageFailures, readyStorage };
