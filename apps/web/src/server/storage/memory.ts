import { streamOf } from './storage';
import type { ObjectStorage } from './storage';

/**
 * Object storage in memory, for tests of everything that stores or serves images.
 *
 * @returns An empty storage.
 */
function createMemoryStorage(): ObjectStorage {
	const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
	return {
		// oxlint-disable-next-line typescript/require-await -- the interface is async, memory is not
		async delete(key) {
			objects.delete(key);
		},
		// oxlint-disable-next-line typescript/require-await -- the interface is async, memory is not
		async get(key) {
			const object = objects.get(key);
			if (object === undefined) return null;
			return {
				body: streamOf(new Uint8Array(object.bytes)),
				contentType: object.contentType,
				size: object.bytes.byteLength,
			};
		},
		// oxlint-disable-next-line typescript/require-await -- the interface is async, memory is not
		async put(key, bytes, { contentType }) {
			objects.set(key, { bytes: new Uint8Array(bytes), contentType });
		},
	};
}

export { createMemoryStorage };
