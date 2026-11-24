import type { ObjectStorage } from './storage';
import { guardStorage } from './storage-error';

/** What `get` of `@vercel/blob` answers: a stream, or (304, never asked for here) no body. */
interface VercelBlobReadResult {
	statusCode: number;
	stream: ReadableStream<Uint8Array> | null;
	blob: Readonly<{ contentType: string | null; size: number | null }>;
}

/** What the storage tells `put` of `@vercel/blob`: private, under the given name, never replaced. */
type VercelBlobPutOptions = Readonly<{
	access: 'private';
	addRandomSuffix: false;
	allowOverwrite: false;
	contentType: string;
	token: string;
}>;

/** The functions of `@vercel/blob` the storage uses, so tests can hand in a fake. */
interface VercelBlobClient {
	put: (pathname: string, body: Blob, options: VercelBlobPutOptions) => Promise<unknown>;
	get: (
		pathname: string,
		options: Readonly<{ access: 'private'; token: string }>,
	) => Promise<VercelBlobReadResult | null>;
	del: (pathname: string, options: Readonly<{ token: string }>) => Promise<void>;
}

/**
 * Object storage in a private Vercel Blob store. The store's access is fixed at its creation;
 * `access: 'private'` states it on every call, so a public store would fail instead of leaking.
 * Keys are unique ids, so overwriting is never wanted (`allowOverwrite: false`). The bytes go as a
 * `Blob`, the body type every runtime of `@vercel/blob` accepts.
 *
 * @param client The functions of `@vercel/blob`.
 * @param token The store's read-write token (`BLOB_READ_WRITE_TOKEN`), passed explicitly.
 * @returns The storage.
 */
function createVercelBlobStorage(client: VercelBlobClient, token: string): ObjectStorage {
	return {
		async delete(key) {
			await guardStorage('delete', async () => client.del(key, { token }));
		},
		async get(key) {
			const result = await guardStorage('get', async () =>
				client.get(key, { access: 'private', token }),
			);
			if (result === null) return null;
			const { contentType, size } = result.blob;
			// A 304 (no body, no type) only answers a conditional read, which the storage never makes.
			if (result.stream === null || contentType === null || size === null) return null;
			return { body: result.stream, contentType, size };
		},
		async put(key, bytes, { contentType }) {
			await guardStorage('put', async () =>
				client.put(key, new Blob([new Uint8Array(bytes)], { type: contentType }), {
					access: 'private',
					addRandomSuffix: false,
					allowOverwrite: false,
					contentType,
					token,
				}),
			);
		},
	};
}

export { createVercelBlobStorage };
export type { VercelBlobClient, VercelBlobPutOptions, VercelBlobReadResult };
