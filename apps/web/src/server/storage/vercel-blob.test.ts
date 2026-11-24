import { describe, expect, it, vi } from 'vite-plus/test';

import { describeStorageContract, readyStorage, expectStorageFailures } from './storage-contract';
import { createVercelBlobStorage } from './vercel-blob';
import type { VercelBlobClient } from './vercel-blob';

const TOKEN = 'vercel_blob_rw_test_token';

const ignore = vi.fn<(call: unknown) => void>();

const failing = (): never => {
	throw new Error(`${TOKEN} media/secret`);
};

// A client that behaves like `@vercel/blob`: a private store, no overwriting, reads stream.
const createFakeClient = (record: (call: unknown) => void): VercelBlobClient => {
	const blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();
	return {
		// oxlint-disable-next-line typescript/require-await -- the client is async, the fake is not
		async del(pathname, options) {
			record({ operation: 'del', options, pathname });
			blobs.delete(pathname);
		},
		// oxlint-disable-next-line typescript/require-await -- the client is async, the fake is not
		async get(pathname, options) {
			record({ operation: 'get', options, pathname });
			const blob = blobs.get(pathname);
			if (blob === undefined) return null;
			return {
				blob: { contentType: blob.contentType, size: blob.bytes.byteLength },
				statusCode: 200,
				stream: new Response(new Uint8Array(blob.bytes)).body,
			};
		},
		async put(pathname, body, options) {
			record({ operation: 'put', options, pathname });
			if (blobs.has(pathname)) throw new Error('This blob already exists');
			blobs.set(pathname, {
				bytes: new Uint8Array(await body.arrayBuffer()),
				contentType: options.contentType,
			});
			return {};
		},
	};
};

describeStorageContract('The Vercel Blob storage', async () =>
	readyStorage(createVercelBlobStorage(createFakeClient(ignore), TOKEN)),
);

describe(createVercelBlobStorage, () => {
	it('keeps every object private, under its own name, and never overwrites', async () => {
		const calls: unknown[] = [];
		const storage = createVercelBlobStorage(
			createFakeClient((call) => {
				calls.push(call);
			}),
			TOKEN,
		);
		await storage.put('media/a', new Uint8Array(1), { contentType: 'image/png' });
		await storage.get('media/a');
		await storage.delete('media/a');
		expect(calls).toStrictEqual([
			{
				operation: 'put',
				options: {
					access: 'private',
					addRandomSuffix: false,
					allowOverwrite: false,
					contentType: 'image/png',
					token: TOKEN,
				},
				pathname: 'media/a',
			},
			{ operation: 'get', options: { access: 'private', token: TOKEN }, pathname: 'media/a' },
			{ operation: 'del', options: { token: TOKEN }, pathname: 'media/a' },
		]);
	});

	it('treats an unchanged answer without a body as missing', async () => {
		const storage = createVercelBlobStorage(
			{
				...createFakeClient(ignore),
				// oxlint-disable-next-line typescript/require-await -- answers at once
				async get() {
					return { blob: { contentType: null, size: null }, statusCode: 304, stream: null };
				},
			},
			TOKEN,
		);
		await expect(storage.get('media/a')).resolves.toBeNull();
	});

	it('names no key, value or token when the store fails', async () => {
		const storage = createVercelBlobStorage({ del: failing, get: failing, put: failing }, TOKEN);
		await expectStorageFailures(storage);
	});
});
