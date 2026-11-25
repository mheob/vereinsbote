import { describe, expect, it, vi } from 'vite-plus/test';

import { parseEnv } from '@/server/env';
import type { Env } from '@/server/env';

import { openStorage } from './open-storage';
import { StorageNotConfiguredError } from './storage';

const putBlob = vi.hoisted(() => vi.fn());

// The real module would call Vercel; only `put` is replaced, to see what the storage hands it.
vi.mock(import('@vercel/blob'), async (importOriginal) => ({
	...(await importOriginal()),
	put: putBlob,
}));

const base = {
	APP_SECRET: Buffer.alloc(32, 7).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://u:p@localhost:5432/vb',
};

const envWith = (extra: Readonly<Record<string, string>> = {}): Env =>
	parseEnv({ ...base, ...extra });

const s3Variables = {
	S3_ACCESS_KEY_ID: 'key',
	S3_BUCKET: 'vereinsbote',
	S3_ENDPOINT: 'http://localhost:8333',
	S3_REGION: 'us-east-1',
	S3_SECRET_ACCESS_KEY: 'secret',
};

const BYTES = new TextEncoder().encode('data');

// A bucket binding that records what is put.
const recordingBucket = (): { bucket: Record<string, unknown>; puts: string[] } => {
	const puts: string[] = [];
	return {
		bucket: {
			delete: vi.fn<() => Promise<void>>(),
			get: vi.fn<() => Promise<null>>(),
			// oxlint-disable-next-line typescript/require-await -- the binding is async, the fake is not
			async put(key: string) {
				puts.push(key);
			},
		},
		puts,
	};
};

describe(openStorage, () => {
	it('uses the R2 bucket on Cloudflare', async () => {
		const { bucket, puts } = recordingBucket();
		const storage = await openStorage(envWith(), { MEDIA_BUCKET: bucket }, 'cloudflare');
		await storage?.put('media/a', BYTES, { contentType: 'image/png' });
		expect(puts).toStrictEqual(['media/a']);
	});

	it('has no storage on Cloudflare without the binding or with a string in its place', async () => {
		await expect(openStorage(envWith(), {}, 'cloudflare')).resolves.toBeNull();
		await expect(openStorage(envWith(), null, 'cloudflare')).resolves.toBeNull();
		await expect(openStorage(envWith(), { MEDIA_BUCKET: 'x' }, 'cloudflare')).resolves.toBeNull();
		await expect(openStorage(envWith(), { MEDIA_BUCKET: {} }, 'cloudflare')).resolves.toBeNull();
	});

	it('uses Vercel Blob with the token on Vercel', async () => {
		const storage = await openStorage(envWith({ BLOB_READ_WRITE_TOKEN: 'token' }), null, 'vercel');
		await storage?.put('media/a', BYTES, { contentType: 'image/png' });
		expect(putBlob).toHaveBeenCalledWith(
			'media/a',
			expect.any(Blob),
			expect.objectContaining({ access: 'private', token: 'token' }),
		);
	});

	it('has no storage on Vercel without the token', async () => {
		await expect(openStorage(envWith(), null, 'vercel')).resolves.toBeNull();
	});

	it('uses the S3 bucket on Node', async () => {
		const storage = await openStorage(envWith(s3Variables), null, 'node');
		// Building the client sends nothing; the requests are tested against SeaweedFS.
		expect([typeof storage?.delete, typeof storage?.get, typeof storage?.put]).toStrictEqual([
			'function',
			'function',
			'function',
		]);
	});

	it('has no storage on Node without S3', async () => {
		await expect(openStorage(envWith(), null, 'node')).resolves.toBeNull();
	});
});

describe(StorageNotConfiguredError, () => {
	it('names no setting', () => {
		expect(new StorageNotConfiguredError().message).toBe('No object storage is configured.');
	});
});
