import { describe, expect, it } from 'vite-plus/test';

import { EnvError, parseEnv } from './env';

const valid = {
	APP_SECRET: Buffer.alloc(32, 7).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://u:p@localhost:5432/vb',
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

	it('accepts a complete MS_LOGIN_* group', () => {
		const env = parseEnv({
			...valid,
			MS_LOGIN_CLIENT_ID: 'id',
			MS_LOGIN_CLIENT_SECRET: 'secret',
			MS_LOGIN_TENANT_ID: 'tenant',
		});
		expect(env.microsoftLogin).toStrictEqual({
			clientId: 'id',
			clientSecret: 'secret',
			tenantId: 'tenant',
		});
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
			MS_LOGIN_TENANT_ID: 'tenant',
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

	it('treats empty optional values as unset', () => {
		const env = parseEnv({ ...valid, DEV_SMTP_URL: '', SETUP_TOKEN: '', TICK_INTERVAL_MS: '' });
		expect(env.setupToken).toBeNull();
		expect(env.devSmtpUrl).toBeNull();
		expect(env.tickIntervalMs).toBe(900_000);
	});
});
