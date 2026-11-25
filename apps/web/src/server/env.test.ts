import { describe, expect, it } from 'vite-plus/test';

import { EnvError, parseEnv } from './env';

/** A tenant ID as Microsoft Entra shows it (a GUID). */
const TENANT_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const valid = {
	APP_SECRET: Buffer.alloc(32, 7).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://u:p@localhost:5432/vb',
};

const s3 = {
	S3_ACCESS_KEY_ID: 'key',
	S3_BUCKET: 'vereinsbote',
	S3_ENDPOINT: 'https://s3.example.org',
	S3_REGION: 'eu-central-1',
	S3_SECRET_ACCESS_KEY: 'secret',
};

// Returns the EnvError thrown by parseEnv; fails the test if nothing or something else is thrown.
const envErrorFor = (source: Readonly<Record<string, string | undefined>>): EnvError => {
	try {
		parseEnv(source);
	} catch (error) {
		if (error instanceof EnvError) return error;
		throw error;
	}
	throw new Error('parseEnv did not throw');
};

describe(parseEnv, () => {
	it('accepts a minimal env with defaults', () => {
		const env = parseEnv(valid);
		expect(env.tickIntervalMs).toBe(900_000);
		expect(env.microsoftLogin).toBeNull();
		expect(env.setupToken).toBeNull();
		expect(env.appSecret).toHaveLength(32);
	});

	it('derives appUrl as URL and appSecret as decoded bytes', () => {
		const env = parseEnv(valid);
		expect(env.appUrl).toBeInstanceOf(URL);
		expect(env.appUrl.host).toBe('bote.example.org');
		expect(env.appSecret).toStrictEqual(new Uint8Array(32).fill(7));
	});

	it('leaves optional integrations unset by default', () => {
		const env = parseEnv(valid);
		expect(env.devSmtpUrl).toBeNull();
		expect(env.heartbeatUrl).toBeNull();
	});

	it('rejects an APP_SECRET that is not 32 bytes', () => {
		expect(() => parseEnv({ ...valid, APP_SECRET: 'abc' })).toThrow(EnvError);
	});

	it('allows http only for localhost', () => {
		expect(() => parseEnv({ ...valid, APP_URL: 'http://bote.example.org' })).toThrow(EnvError);
		expect(parseEnv({ ...valid, APP_URL: 'http://localhost:3000' }).appUrl.host).toBe(
			'localhost:3000',
		);
		expect(parseEnv({ ...valid, APP_URL: 'http://127.0.0.1:3000' }).appUrl.hostname).toBe(
			'127.0.0.1',
		);
	});

	it('requires all MS_LOGIN_* or none', () => {
		expect(() => parseEnv({ ...valid, MS_LOGIN_CLIENT_ID: 'id' })).toThrow(/MS_LOGIN_/u);
		expect(envErrorFor({ ...valid, MS_LOGIN_CLIENT_ID: 'id' }).variables).toStrictEqual([
			'MS_LOGIN_CLIENT_SECRET',
			'MS_LOGIN_TENANT_ID',
		]);
	});

	it('needs all S3 variables or none', () => {
		expect(envErrorFor({ ...valid, S3_BUCKET: 'vereinsbote' }).variables).toStrictEqual([
			'S3_ENDPOINT',
			'S3_REGION',
			'S3_ACCESS_KEY_ID',
			'S3_SECRET_ACCESS_KEY',
		]);
		expect(parseEnv(valid).s3).toBeNull();
	});

	it('reads a complete S3 group', () => {
		const env = parseEnv({ ...valid, ...s3 });
		expect(env.s3).toStrictEqual({
			accessKeyId: 'key',
			bucket: 'vereinsbote',
			endpoint: new URL('https://s3.example.org'),
			region: 'eu-central-1',
			secretAccessKey: 'secret',
		});
	});

	it('refuses plain http for S3 except locally', () => {
		expect(
			envErrorFor({ ...valid, ...s3, S3_ENDPOINT: 'http://s3.example' }).variables,
		).toStrictEqual(['S3_ENDPOINT']);
		expect(
			parseEnv({ ...valid, ...s3, S3_ENDPOINT: 'http://localhost:8333' }).s3?.endpoint.host,
		).toBe('localhost:8333');
		expect(envErrorFor({ ...valid, ...s3, S3_ENDPOINT: 'not a url' }).variables).toStrictEqual([
			'S3_ENDPOINT',
		]);
	});

	it('names no S3 value in its error', () => {
		expect(envErrorFor({ ...valid, ...s3, S3_BUCKET: 'Bad Bucket!' }).message).not.toContain('Bad');
	});

	it('reads the Vercel Blob token', () => {
		expect(parseEnv(valid).blobToken).toBeNull();
		expect(parseEnv({ ...valid, BLOB_READ_WRITE_TOKEN: ' vercel_blob_rw_x ' }).blobToken).toBe(
			'vercel_blob_rw_x',
		);
	});

	it('accepts a complete MS_LOGIN_* group', () => {
		const env = parseEnv({
			...valid,
			MS_LOGIN_CLIENT_ID: 'id',
			MS_LOGIN_CLIENT_SECRET: 'secret',
			MS_LOGIN_TENANT_ID: TENANT_ID,
		});
		expect(env.microsoftLogin).toStrictEqual({
			clientId: 'id',
			clientSecret: 'secret',
			tenantId: TENANT_ID,
		});
	});

	it.each(['common', 'organizations', 'consumers', 'verein-tenant', `${TENANT_ID}x`])(
		'rejects the tenant %s: only a tenant ID restricts the sign-in to the club',
		(tenantId) => {
			const error = envErrorFor({
				...valid,
				MS_LOGIN_CLIENT_ID: 'id',
				MS_LOGIN_CLIENT_SECRET: 'secret',
				MS_LOGIN_TENANT_ID: tenantId,
			});
			expect(error.variables).toStrictEqual(['MS_LOGIN_TENANT_ID']);
			expect(error.message).not.toContain(tenantId);
		},
	);

	it('accepts a tenant ID in upper case', () => {
		const env = parseEnv({
			...valid,
			MS_LOGIN_CLIENT_ID: 'id',
			MS_LOGIN_CLIENT_SECRET: 'secret',
			MS_LOGIN_TENANT_ID: TENANT_ID.toUpperCase(),
		});
		expect(env.microsoftLogin?.tenantId).toBe(TENANT_ID.toUpperCase());
	});

	it('trims every value before checking it', () => {
		const env = parseEnv({
			APP_SECRET: ` ${valid.APP_SECRET}\n`,
			APP_URL: ` ${valid.APP_URL} `,
			CRON_SECRET: `${valid.CRON_SECRET}\t`,
			DATABASE_URL: ` ${valid.DATABASE_URL}`,
			MS_LOGIN_CLIENT_ID: ' id ',
			MS_LOGIN_CLIENT_SECRET: ' secret ',
			MS_LOGIN_TENANT_ID: ` ${TENANT_ID} `,
			SETUP_TOKEN: '   ',
		});
		expect(env.appUrl.href).toBe('https://bote.example.org/');
		expect(env.cronSecret).toBe(valid.CRON_SECRET);
		expect(env.databaseUrl).toBe(valid.DATABASE_URL);
		expect(env.microsoftLogin).toStrictEqual({
			clientId: 'id',
			clientSecret: 'secret',
			tenantId: TENANT_ID,
		});
		expect(env.setupToken).toBeNull();
	});

	it.each([
		'https://bote.example.org/app',
		'https://bote.example.org/?x=1',
		'https://bote.example.org/#top',
	])('rejects an APP_URL with a path, query or fragment: %s', (appUrl) => {
		expect(envErrorFor({ ...valid, APP_URL: appUrl }).variables).toStrictEqual(['APP_URL']);
	});

	it('accepts an APP_URL with a port and a trailing slash', () => {
		expect(parseEnv({ ...valid, APP_URL: 'https://bote.example.org:8443/' }).appUrl.origin).toBe(
			'https://bote.example.org:8443',
		);
	});

	it('rejects a tick interval below one minute', () => {
		expect(() => parseEnv({ ...valid, TICK_INTERVAL_MS: '30000' })).toThrow(EnvError);
		expect(parseEnv({ ...valid, TICK_INTERVAL_MS: '60000' }).tickIntervalMs).toBe(60_000);
	});

	it('reports variable names but never secret values', () => {
		const error = envErrorFor({ ...valid, APP_SECRET: 'geheim-zu-kurz' });
		expect(String(error)).not.toContain('geheim-zu-kurz');
		expect(error.variables).toStrictEqual(['APP_SECRET']);
	});

	it('lists all offending variables in rule order', () => {
		const error = envErrorFor({
			...valid,
			CRON_SECRET: 'kurz',
			DATABASE_URL: 'mysql://x',
			DEV_SMTP_URL: 'http://x',
			HEARTBEAT_URL: 'http://x',
			MS_LOGIN_TENANT_ID: TENANT_ID,
			SETUP_TOKEN: 'kurz',
		});
		expect(error.variables).toStrictEqual([
			'DATABASE_URL',
			'CRON_SECRET',
			'SETUP_TOKEN',
			'MS_LOGIN_CLIENT_ID',
			'MS_LOGIN_CLIENT_SECRET',
			'DEV_SMTP_URL',
			'HEARTBEAT_URL',
		]);
		expect(error.message).toContain('CRON_SECRET');
	});

	it('leaves the local Neon proxy unset by default', () => {
		expect(parseEnv(valid).devNeonWsProxy).toBeNull();
	});

	it('accepts a local Neon proxy for a local APP_URL', () => {
		const env = parseEnv({
			...valid,
			APP_URL: 'http://localhost:8787',
			DEV_NEON_WS_PROXY: 'localhost:4444/v1',
		});
		expect(env.devNeonWsProxy).toBe('localhost:4444/v1');
	});

	it.each([
		['https://bote.example.org', 'localhost:4444/v1'],
		['http://localhost:8787', 'ws://localhost:4444/v1'],
		['http://localhost:8787', 'localhost:4444/v1?address=x'],
	])('rejects the local Neon proxy with APP_URL %s and %s', (appUrl, proxy) => {
		const error = envErrorFor({ ...valid, APP_URL: appUrl, DEV_NEON_WS_PROXY: proxy });
		expect(error.variables).toStrictEqual(['DEV_NEON_WS_PROXY']);
	});

	it('treats empty optional values as unset', () => {
		const env = parseEnv({ ...valid, DEV_SMTP_URL: '', SETUP_TOKEN: '', TICK_INTERVAL_MS: '' });
		expect(env.setupToken).toBeNull();
		expect(env.devSmtpUrl).toBeNull();
		expect(env.tickIntervalMs).toBe(900_000);
	});
});
