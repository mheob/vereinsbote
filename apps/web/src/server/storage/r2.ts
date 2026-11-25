import type { ObjectStorage } from './storage';
import { guardStorage } from './storage-error';

/** The part of an R2 object with a body that the storage reads. */
interface R2ObjectBodyLike {
	body: ReadableStream<Uint8Array>;
	size: number;
	httpMetadata?: Readonly<{ contentType?: string }>;
}

/** The options of `put` the storage sets. */
type R2PutOptions = Readonly<{ httpMetadata?: Readonly<{ contentType?: string }> }>;

/** The part of Cloudflare's `R2Bucket` binding the storage uses. */
interface R2BucketLike {
	put: (key: string, value: Uint8Array, options?: R2PutOptions) => Promise<unknown>;
	get: (key: string) => Promise<R2ObjectBodyLike | null>;
	delete: (key: string) => Promise<void>;
}

/**
 * Object storage in an R2 bucket (the `MEDIA_BUCKET` binding of the Worker). R2 is private
 * unless a custom domain or `r2.dev` is switched on, which the app never does: images are served
 * by the app itself.
 *
 * @param bucket The binding.
 * @returns The storage.
 */
function createR2Storage(bucket: R2BucketLike): ObjectStorage {
	return {
		async delete(key) {
			await guardStorage('delete', async () => bucket.delete(key));
		},
		async get(key) {
			const object = await guardStorage('get', async () => bucket.get(key));
			if (object === null) return null;
			return {
				body: object.body,
				contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
				size: object.size,
			};
		},
		async put(key, bytes, { contentType }) {
			await guardStorage('put', async () =>
				bucket.put(key, bytes, { httpMetadata: { contentType } }),
			);
		},
	};
}

export { createR2Storage };
export type { R2BucketLike, R2ObjectBodyLike, R2PutOptions };
