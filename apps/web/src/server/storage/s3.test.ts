import { describe, expect, it } from 'vite-plus/test';

import { createS3StorageFor, s3ClientEndpoint } from './s3';
import type { S3ClientLike } from './s3';
import { describeStorageContract, readyStorage, expectStorageFailures } from './storage-contract';

const failing = (): never => {
	throw new Error('media/secret AKIASECRET');
};

// A client that behaves like `s3mini` against a bucket: reads answer a Response, or null.
const createFakeClient = (withLength = true): S3ClientLike => {
	const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
	return {
		// oxlint-disable-next-line typescript/require-await -- the client is async, the fake is not
		async deleteObject(key) {
			objects.delete(key);
			return true;
		},
		// oxlint-disable-next-line typescript/require-await -- the client is async, the fake is not
		async getObjectResponse(key) {
			const object = objects.get(key);
			if (object === undefined) return null;
			const headers: Record<string, string> = { 'content-type': object.contentType };
			if (withLength) headers['content-length'] = String(object.bytes.byteLength);
			return new Response(new Uint8Array(object.bytes), { headers });
		},
		// oxlint-disable-next-line typescript/require-await -- the client is async, the fake is not
		async putObject(key, bytes, contentType) {
			objects.set(key, { bytes: new Uint8Array(bytes), contentType });
			return new Response(null);
		},
	};
};

describeStorageContract('The S3 storage', async () =>
	readyStorage(createS3StorageFor(createFakeClient())),
);

describe(createS3StorageFor, () => {
	it('measures a body that comes without a length', async () => {
		const storage = createS3StorageFor(createFakeClient(false));
		const bytes = new Uint8Array(3).fill(7);
		await storage.put('media/a', bytes, { contentType: 'image/jpeg' });
		const stored = await storage.get('media/a');
		expect(stored?.size).toBe(3);
		expect(new Uint8Array(await new Response(stored?.body).arrayBuffer())).toStrictEqual(bytes);
	});

	it('names no key, value or credential when the service fails', async () => {
		const storage = createS3StorageFor({
			deleteObject: failing,
			getObjectResponse: failing,
			putObject: failing,
		});
		await expectStorageFailures(storage);
	});
});

describe(s3ClientEndpoint, () => {
	it('puts the bucket after the endpoint', () => {
		expect(s3ClientEndpoint(new URL('http://localhost:8333'), 'vereinsbote')).toBe(
			'http://localhost:8333/vereinsbote',
		);
		expect(s3ClientEndpoint(new URL('https://s3.example.org/base/'), 'club')).toBe(
			'https://s3.example.org/base/club',
		);
	});
});
