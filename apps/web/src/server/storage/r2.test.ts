import { describe, expect, it } from 'vite-plus/test';

import { createR2Storage } from './r2';
import type { R2BucketLike } from './r2';
import { describeStorageContract, expectStorageFailures } from './storage-contract';

// A bucket as R2's binding behaves: reads give the body, the size and the stored type.
const createFakeBucket = (): R2BucketLike => {
	const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
	return {
		// oxlint-disable-next-line typescript/require-await -- the binding is async, the fake is not
		async delete(key) {
			objects.delete(key);
		},
		// oxlint-disable-next-line typescript/require-await -- the binding is async, the fake is not
		async get(key) {
			const object = objects.get(key);
			if (object === undefined) return null;
			return {
				body: new Response(new Uint8Array(object.bytes)).body ?? new ReadableStream(),
				httpMetadata: { contentType: object.contentType },
				size: object.bytes.byteLength,
			};
		},
		// oxlint-disable-next-line typescript/require-await -- the binding is async, the fake is not
		async put(key, value, options) {
			objects.set(key, {
				bytes: new Uint8Array(value),
				contentType: options?.httpMetadata?.contentType,
			});
		},
	};
};

const failing = (): never => {
	throw new Error('secret-key-in-message');
};

describeStorageContract('The R2 storage', () => createR2Storage(createFakeBucket()));

describe(createR2Storage, () => {
	it('falls back to a binary type for an object stored without one', async () => {
		const bucket = createFakeBucket();
		await bucket.put('media/x', new Uint8Array(1));
		const stored = await createR2Storage(bucket).get('media/x');
		expect(stored?.contentType).toBe('application/octet-stream');
	});

	it('names no key or value when R2 fails', async () => {
		const storage = createR2Storage({ delete: failing, get: failing, put: failing });
		await expectStorageFailures(storage);
	});
});
