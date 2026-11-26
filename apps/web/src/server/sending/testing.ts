import { deriveSecretsKey } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { parseEnv } from '@/server/env';
import type { Env } from '@/server/env';
import type { Principal } from '@/server/permissions/principal';

import { createConnection } from './connections';
import { createSender } from './senders';

const SECRET_BYTES = 32;
const SECRET_FILL = 7;

/**
 * The environment of the sending tests: no dev provider, so the real endpoints are used.
 *
 * @returns The environment.
 */
function testEnv(): Env {
	return parseEnv({
		APP_SECRET: Buffer.alloc(SECRET_BYTES, SECRET_FILL).toString('base64'),
		APP_URL: 'https://bote.example.org',
		CRON_SECRET: 'c'.repeat(SECRET_BYTES),
		DATABASE_URL: 'postgres://x@localhost/x',
	});
}

/**
 * The key of the secrets of `testEnv`.
 *
 * @returns The key.
 */
async function testKey(): Promise<CryptoKey> {
	return deriveSecretsKey(testEnv().appSecret);
}

/**
 * A Graph connection with a secret, as an admin makes it. For tests only.
 *
 * @param db The test database.
 * @param admin An admin.
 * @param name The name of the connection.
 * @returns Its id.
 */
async function graphConnection(db: Db, admin: Principal, name = 'Microsoft 365'): Promise<string> {
	const { id } = await createConnection(
		db,
		admin,
		{
			clientId: 'client-id-1',
			clientSecret: 'graph-client-secret-1',
			kind: 'graph',
			name,
			secretExpiresOn: '2027-06-30',
			tenantId: 'tenant-1',
		},
		await testKey(),
	);
	return id;
}

/**
 * A Resend connection with a key, as an admin makes it. For tests only.
 *
 * @param db The test database.
 * @param admin An admin.
 * @param name The name of the connection.
 * @returns Its id.
 */
async function resendConnection(db: Db, admin: Principal, name = 'Resend'): Promise<string> {
	const { id } = await createConnection(
		db,
		admin,
		{
			apiKey: 're_test_key_1',
			dailyLimit: 100,
			kind: 'resend',
			name,
			perMinute: 60,
			webhookSecret: 'whsec_dGVzdA==',
		},
		await testKey(),
	);
	return id;
}

/**
 * A sender on a connection. For tests only.
 *
 * @param db The test database.
 * @param admin An admin.
 * @param connectionId The connection.
 * @param email The address.
 * @param areaIds The released areas.
 * @returns Its id.
 */
// oxlint-disable-next-line max-params -- a test helper with the plain parts of a sender
async function senderOn(
	db: Db,
	admin: Principal,
	connectionId: string,
	email: string,
	areaIds: readonly string[] = [],
): Promise<string> {
	const { id } = await createSender(db, admin, {
		archiveBcc: null,
		areaIds,
		connectionId,
		dailyLimit: null,
		displayName: 'Verein',
		email,
		perMinute: null,
		replyTo: null,
	});
	return id;
}

const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/** One request the fake providers saw. */
interface FakeCall {
	readonly url: string;
	readonly method: string;
	readonly headers: Headers;
	readonly body: string;
}

/** The status the fake providers answer with, by step; the defaults are the happy path. */
interface FakeBehavior {
	readonly token?: number;
	readonly send?: number;
	readonly probe?: number;
}

/**
 * The answer of the fake Graph and Resend for one request.
 *
 * @param url The address.
 * @param behavior The statuses to answer with.
 * @returns The response.
 */
function answerFor(url: string, behavior: Readonly<FakeBehavior>): Response {
	if (url.includes('/oauth2/v2.0/token')) {
		const status = behavior.token ?? HTTP_OK;
		return status === HTTP_OK
			? Response.json({ access_token: 'token-1', expires_in: 3600, token_type: 'Bearer' })
			: Response.json({ error: 'invalid_client' }, { status });
	}
	if (url.endsWith('/sendMail'))
		return new Response(null, { status: behavior.send ?? HTTP_ACCEPTED });
	if (url.includes('/messages')) {
		const status = behavior.probe ?? HTTP_FORBIDDEN;
		return Response.json(status === HTTP_OK ? { value: [] } : { error: {} }, { status });
	}
	if (url.endsWith('/emails')) {
		return Response.json({ id: 'resend-1' }, { status: behavior.send ?? HTTP_OK });
	}
	return new Response(null, { status: HTTP_NOT_FOUND });
}

/**
 * A `fetch` double that answers like Graph and Resend and records every request. For tests only.
 *
 * @param behavior The statuses to answer with.
 * @returns The `fetch` and the list of requests it saw.
 */
function fakeProviders(behavior: Readonly<FakeBehavior> = {}): {
	fetch: typeof fetch;
	calls: FakeCall[];
} {
	const calls: FakeCall[] = [];
	const answer: typeof fetch = async (input, init) => {
		let url = input instanceof Request ? input.url : String(input);
		if (input instanceof URL) url = input.href;
		const body = typeof init?.body === 'string' ? init.body : '';
		calls.push({ body, headers: new Headers(init?.headers), method: init?.method ?? 'GET', url });
		const response = await Promise.resolve(answerFor(url, behavior));
		return response;
	};
	return { calls, fetch: answer };
}

export { fakeProviders, graphConnection, resendConnection, senderOn, testEnv, testKey };
export type { FakeCall };
