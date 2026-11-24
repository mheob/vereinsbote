import { streamOf } from './storage';
import type { ObjectStorage } from './storage';
import { guardStorage } from './storage-error';

/** Where and how to reach the bucket (`S3_*`, see `src/server/env.ts`). */
interface S3Config {
	endpoint: URL;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

/** The functions of `s3mini` the storage uses, so tests can hand in a fake. */
interface S3ClientLike {
	putObject: (key: string, bytes: Uint8Array, contentType: string) => Promise<unknown>;
	/** Answers null for a missing key. */
	getObjectResponse: (key: string) => Promise<Response | null>;
	deleteObject: (key: string) => Promise<unknown>;
}

/**
 * s3mini addresses the bucket as the last path segment of its endpoint (path style).
 *
 * @param endpoint The service's URL.
 * @param bucket The bucket's name.
 * @returns The URL to give s3mini.
 */
function s3ClientEndpoint(endpoint: URL, bucket: string): string {
	const base = endpoint.href.endsWith('/') ? endpoint.href : `${endpoint.href}/`;
	return `${base}${bucket}`;
}

/**
 * Reads the length a response announces, or measures its body when it announces none.
 *
 * @param response A successful read.
 * @returns The body and its size.
 */
async function bodyWithSize(
	response: Response,
): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
	const announced = Number(response.headers.get('content-length'));
	if (response.body !== null && Number.isSafeInteger(announced) && announced > 0) {
		return { body: response.body, size: announced };
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	return { body: streamOf(bytes), size: bytes.byteLength };
}

/**
 * Object storage on top of an S3 client.
 *
 * @param client The functions of `s3mini`.
 * @returns The storage.
 */
function createS3StorageFor(client: S3ClientLike): ObjectStorage {
	return {
		async delete(key) {
			await guardStorage('delete', async () => client.deleteObject(key));
		},
		async get(key) {
			return guardStorage('get', async () => {
				const response = await client.getObjectResponse(key);
				if (response === null) return null;
				return {
					...(await bodyWithSize(response)),
					contentType: response.headers.get('content-type') ?? 'application/octet-stream',
				};
			});
		},
		async put(key, bytes, { contentType }) {
			await guardStorage('put', async () => client.putObject(key, bytes, contentType));
		},
	};
}

/**
 * Object storage in an S3 bucket (SeaweedFS in development and tests, any S3 service in
 * production). Node and Docker only: `s3mini` is loaded here, on the first call, so the other
 * builds never contain it (see `openStorage`).
 *
 * @param config The service, the bucket and the credentials.
 * @returns The storage.
 */
async function createS3Storage(config: Readonly<S3Config>): Promise<ObjectStorage> {
	const { S3mini } = await import('s3mini');
	return createS3StorageFor(
		new S3mini({
			accessKeyId: config.accessKeyId,
			endpoint: s3ClientEndpoint(config.endpoint, config.bucket),
			region: config.region,
			secretAccessKey: config.secretAccessKey,
		}),
	);
}

export { createS3Storage, createS3StorageFor, s3ClientEndpoint };
export type { S3ClientLike, S3Config };
