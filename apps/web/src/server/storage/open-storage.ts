import { platformName } from '@/platform/platform';
import type { PlatformName } from '@/platform/platform';
import type { Env } from '@/server/env';

import { createR2Storage } from './r2';
import type { R2BucketLike } from './r2';
import type { S3Config } from './s3';
import type { ObjectStorage } from './storage';

/** The name of the R2 binding in `wrangler.jsonc`. */
const MEDIA_BUCKET_BINDING = 'MEDIA_BUCKET';

const isR2Bucket = (value: unknown): value is R2BucketLike =>
	typeof value === 'object' &&
	value !== null &&
	'put' in value &&
	typeof value.put === 'function' &&
	'get' in value &&
	typeof value.get === 'function' &&
	'delete' in value &&
	typeof value.delete === 'function';

/**
 * Opens a private Vercel Blob store. The Blob library loads here only, and only in the Vercel build:
 * the platform constant removes the branch from the other bundles (the unset constant of `vp dev`
 * and of the tests passes).
 *
 * @param token The store's read-write token, if set.
 * @returns The storage, or null without a token or outside the Vercel build.
 */
async function openVercelBlob(token: string | null): Promise<ObjectStorage | null> {
	if (
		import.meta.env.VITE_VB_PLATFORM !== 'cloudflare' &&
		import.meta.env.VITE_VB_PLATFORM !== 'node' &&
		token !== null
	) {
		const [{ createVercelBlobStorage }, client] = await Promise.all([
			import('./vercel-blob'),
			import('@vercel/blob'),
		]);
		return createVercelBlobStorage(client, token);
	}
	return null;
}

/**
 * Opens the S3 bucket. The S3 client library loads here only, and only in the Node build (Node,
 * Docker and `vp dev`).
 *
 * @param s3 The `S3_*` settings, if set.
 * @returns The storage, or null without settings or outside the Node build.
 */
async function openS3(s3: Readonly<S3Config> | null): Promise<ObjectStorage | null> {
	if (
		import.meta.env.VITE_VB_PLATFORM !== 'cloudflare' &&
		import.meta.env.VITE_VB_PLATFORM !== 'vercel' &&
		s3 !== null
	) {
		const { createS3Storage } = await import('./s3');
		return createS3Storage(s3);
	}
	return null;
}

/**
 * Opens the object storage of the platform: R2 on Cloudflare, a private Vercel Blob store on
 * Vercel, an S3 bucket on Node/Docker. Each is unset until its settings exist, and the app then
 * has no image storage (a `null`, handled where images are stored or served).
 *
 * The libraries load by dynamic import behind build constants (like the database and mail drivers), so a
 * bundle holds only its own platform's code; CI checks the Worker bundle.
 *
 * @param env The validated environment.
 * @param bindings Cloudflare's bindings (the R2 bucket is an object among them), null elsewhere.
 * @param platform The platform; tests hand it in, the build constant otherwise.
 * @returns The storage, or null when the platform has none configured.
 */
async function openStorage(
	env: Env,
	bindings: Readonly<Record<string, unknown>> | null,
	platform: PlatformName = platformName(),
): Promise<ObjectStorage | null> {
	if (platform === 'cloudflare') {
		const bucket = bindings?.[MEDIA_BUCKET_BINDING];
		return isR2Bucket(bucket) ? createR2Storage(bucket) : null;
	}
	if (platform === 'vercel') return openVercelBlob(env.blobToken);
	return openS3(env.s3);
}

export { MEDIA_BUCKET_BINDING, openStorage };
