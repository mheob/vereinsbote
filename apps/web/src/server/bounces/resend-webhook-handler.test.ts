import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { RESEND_WEBHOOK_PATH } from '@/paths';
import type { Db } from '@/server/db/client';
import {
	auditLog,
	contactBounces,
	contactOptOuts,
	mailConnections,
	outboxEntries,
	systemState,
	webhookEvents,
} from '@/server/db/schema';
import { WEBHOOK_MAX_BYTES } from '@/server/sending/resend-webhook';
import { graphConnection, resendConnection, testEnv, testKey } from '@/server/sending/testing';

import { handleResendWebhook } from './resend-webhook-handler';
import { setUpSentWave } from './testing';
import type { SentWave } from './testing';

const NOW = new Date('2026-11-26T10:00:00.000Z');
const SECONDS = Math.floor(NOW.getTime() / 1000);
const APP = 'https://bote.example.org';
/** The bytes of the webhook secret of `resendConnection` (`whsec_dGVzdA==`). */
const SECRET_BYTES = new TextEncoder().encode('test');
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_NOT_ALLOWED = 405;
const HTTP_TOO_LARGE = 413;
/** Six minutes: beyond the tolerance of five. */
const STALE_SECONDS = 360;
const CHUNK_BYTES = 16_384;

/** How a test signs a body: the event id, the time and the key. */
interface Signing {
	readonly id?: string;
	readonly timestamp?: number;
	readonly key?: Uint8Array;
}

/** What a response came to: its status, and whether it had a body or set a cookie. */
interface Answer {
	readonly status: number;
	readonly body: string;
	readonly cookie: string | null;
}

/**
 * The base64 of some bytes.
 *
 * @param bytes The bytes.
 * @returns The text.
 */
function base64(bytes: Uint8Array): string {
	return btoa(String.fromCodePoint(...bytes));
}

/**
 * The Svix signature of a body.
 *
 * @param content `id.timestamp.body`.
 * @param keyBytes The key.
 * @returns `v1,<base64>`.
 */
async function signature(content: string, keyBytes: Uint8Array): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new Uint8Array(keyBytes),
		{ hash: 'SHA-256', name: 'HMAC' },
		false,
		['sign'],
	);
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content));
	return `v1,${base64(new Uint8Array(mac))}`;
}

/**
 * The Svix headers of a body.
 *
 * @param body The raw body.
 * @param signing The event id, the time and the key; a fresh id, now and the connection's key by
 *   default.
 * @returns The headers.
 */
async function svixHeaders(body: string, signing: Readonly<Signing> = {}): Promise<Headers> {
	const id = signing.id ?? `msg_${randomUUID()}`;
	const timestamp = signing.timestamp ?? SECONDS;
	return new Headers({
		'content-type': 'application/json',
		'svix-id': id,
		'svix-signature': await signature(`${id}.${timestamp}.${body}`, signing.key ?? SECRET_BYTES),
		'svix-timestamp': String(timestamp),
	});
}

/**
 * A bounce event of Resend.
 *
 * @param emailId The id Resend gave the mail.
 * @param type `Permanent` (hard) or another type (soft).
 * @returns The JSON body.
 */
function bounced(emailId: string, type = 'Permanent'): string {
	return JSON.stringify({
		created_at: NOW.toISOString(),
		data: { bounce: { message: 'Mailbox does not exist', type }, email_id: emailId },
		type: 'email.bounced',
	});
}

/**
 * Another event of Resend.
 *
 * @param type The type.
 * @param emailId The id Resend gave the mail.
 * @returns The JSON body.
 */
function eventOf(type: string, emailId: string): string {
	return JSON.stringify({ data: { email_id: emailId }, type });
}

/**
 * The address of a connection's webhook.
 *
 * @param connectionId The connection.
 * @returns The URL.
 */
function webhookUrl(connectionId: string): string {
	return `${APP}${RESEND_WEBHOOK_PATH}/${connectionId}`;
}

/**
 * Answers a request with the handler and reads the response.
 *
 * @param db The database.
 * @param request The request.
 * @returns The status, the body and the cookie of the response.
 */
async function answer(db: Db, request: Request): Promise<Answer> {
	const response = await handleResendWebhook(request, {
		db,
		env: testEnv(),
		key: await testKey(),
		now: () => NOW,
	});
	return {
		body: await response.text(),
		cookie: response.headers.get('set-cookie'),
		status: response.status,
	};
}

/**
 * The status of an answer that must be empty and set no cookie.
 *
 * @param answered The answer.
 * @returns The status.
 */
function statusOf(answered: Answer): number {
	expect({ body: answered.body, cookie: answered.cookie }).toStrictEqual({
		body: '',
		cookie: null,
	});
	return answered.status;
}

/**
 * Posts a body to a connection's webhook, signed unless headers are given.
 *
 * @param wave The club.
 * @param body The body.
 * @param options How to sign it, or headers of its own, and the connection (the club's by default).
 * @returns The status of the empty answer.
 */
async function post(
	wave: SentWave,
	body: ReadableStream<Uint8Array> | string,
	options: Readonly<Signing & { headers?: Headers; connectionId?: string }> = {},
): Promise<number> {
	const signed = typeof body === 'string' ? body : '';
	const headers = options.headers ?? (await svixHeaders(signed, options));
	const url = webhookUrl(options.connectionId ?? wave.club.connectionId);
	const request = new Request(url, {
		body,
		// @ts-expect-error -- Node needs `duplex` for a stream body; the DOM types lack it
		duplex: 'half',
		headers,
		method: 'POST',
	});
	return statusOf(await answer(wave.club.db, request));
}

/**
 * The status of an entry.
 *
 * @param db The database.
 * @param entryId The entry.
 * @returns The status.
 */
async function entryStatus(db: Db, entryId: string): Promise<string | undefined> {
	const [row] = await db
		.select({ status: outboxEntries.status })
		.from(outboxEntries)
		.where(eq(outboxEntries.id, entryId));
	return row?.status;
}

/**
 * What a webhook request could have written: the disturbances of the connections, the state
 * markers, the activity log and the processed events.
 *
 * @param db The database.
 * @returns A snapshot to compare.
 */
async function writtenState(db: Db): Promise<unknown> {
	return {
		audit: await db.$count(auditLog),
		disturbed: await db
			.select({ code: mailConnections.disturbedCode, since: mailConnections.disturbedSince })
			.from(mailConnections)
			.orderBy(mailConnections.id),
		events: await db.$count(webhookEvents),
		marks: await db.$count(contactBounces),
		state: await db.select({ key: systemState.key }).from(systemState).orderBy(systemState.key),
	};
}

/**
 * A body stream of many chunks that counts how many were read.
 *
 * @param chunks How many chunks of 16 KiB it has.
 * @returns The stream and the count.
 */
function countedStream(chunks: number): {
	stream: ReadableStream<Uint8Array>;
	pulled: () => number;
} {
	let pulled = 0;
	const chunk = new Uint8Array(CHUNK_BYTES).fill(0x61);
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			pulled += 1;
			if (pulled > chunks) controller.close();
			else controller.enqueue(chunk);
		},
	});
	return { pulled: () => pulled, stream };
}

/**
 * The statuses of requests one after another.
 *
 * @param requests The requests.
 * @returns Their statuses.
 */
async function statusesOf(requests: readonly (() => Promise<number>)[]): Promise<number[]> {
	const statuses: number[] = [];
	for (const request of requests) {
		// oxlint-disable-next-line no-await-in-loop -- one request after another
		statuses.push(await request());
	}
	return statuses;
}

describe(handleResendWebhook, () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('answers the webhook only with a valid signature, once per event, within 64 KiB', async () => {
		const wave = await setUpSentWave('resend');
		const { db } = wave.club;
		const body = bounced(wave.family.providerId);
		const id = 'msg_einmal';
		const large = JSON.stringify({ padding: 'x'.repeat(WEBHOOK_MAX_BYTES), type: 'email.bounced' });

		const statuses = await statusesOf([
			async () => post(wave, body, { key: new Uint8Array(4) }),
			async () => post(wave, body, { id }),
			async () => {
				// The same event again (a retry of Resend): answered, without effect.
				await db.delete(contactBounces);
				return post(wave, body, { id });
			},
			// A signed body above 64 KiB, without a declared length.
			async () => post(wave, new Blob([large]).stream(), { headers: await svixHeaders(large) }),
		]);

		expect(statuses).toStrictEqual([HTTP_UNAUTHORIZED, HTTP_OK, HTTP_OK, HTTP_TOO_LARGE]);
		await expect(entryStatus(db, wave.family.id)).resolves.toBe('bounced');
		await expect(db.$count(contactBounces)).resolves.toBe(0);
		await expect(db.select({ id: webhookEvents.id }).from(webhookEvents)).resolves.toStrictEqual([
			{ id },
		]);
	});

	it('allows only POST', async () => {
		const wave = await setUpSentWave('resend');
		const methods = ['GET', 'PUT', 'DELETE'];
		const answers = [];
		for (const method of methods) {
			const request = new Request(webhookUrl(wave.club.connectionId), { method });
			// oxlint-disable-next-line no-await-in-loop -- one method after another
			const response = await handleResendWebhook(request, {
				db: wave.club.db,
				env: testEnv(),
				// oxlint-disable-next-line no-await-in-loop -- see above
				key: await testKey(),
				now: () => NOW,
			});
			answers.push([response.status, response.headers.get('allow')]);
		}
		expect(answers).toStrictEqual(methods.map(() => [HTTP_NOT_ALLOWED, 'POST']));
	});

	it('refuses a larger body by its declared length before reading it', async () => {
		const wave = await setUpSentWave('resend');
		const { pulled, stream } = countedStream(8);
		const headers = await svixHeaders('{}');
		headers.set('content-length', String(WEBHOOK_MAX_BYTES + 1));
		await expect(post(wave, stream, { headers })).resolves.toBe(HTTP_TOO_LARGE);
		// The stream's first pull happens when it is made; nothing more was read.
		expect(pulled()).toBeLessThanOrEqual(1);
	});

	it('stops reading a body that grows past 64 KiB', async () => {
		const wave = await setUpSentWave('resend');
		const chunks = 64;
		const { pulled, stream } = countedStream(chunks);
		await expect(post(wave, stream, { headers: await svixHeaders('{}') })).resolves.toBe(
			HTTP_TOO_LARGE,
		);
		expect(pulled()).toBeLessThan(chunks);
	});

	it('answers 404 for an unknown connection or one of Graph', async () => {
		const wave = await setUpSentWave('resend');
		const { admin, db } = wave.club;
		const graphId = await graphConnection(db, admin, 'Microsoft');
		const body = bounced(wave.family.providerId);
		const statuses = await statusesOf(
			[randomUUID(), graphId, 'keine-id'].map(
				(connectionId) => async () => post(wave, body, { connectionId }),
			),
		);
		expect(statuses).toStrictEqual([HTTP_NOT_FOUND, HTTP_NOT_FOUND, HTTP_NOT_FOUND]);
		await expect(entryStatus(db, wave.family.id)).resolves.toBe('sent');
	});

	it('answers 401 without a valid signature or outside the time tolerance', async () => {
		const wave = await setUpSentWave('resend');
		const { admin, db } = wave.club;
		const body = bounced(wave.family.providerId);
		// A Resend connection without a webhook secret cannot check any signature.
		const withoutSecret = await resendConnection(db, admin, 'Ohne Secret');
		await db
			.update(mailConnections)
			.set({ webhookSecretCiphertext: null })
			.where(eq(mailConnections.id, withoutSecret));

		const statuses = await statusesOf([
			async () => post(wave, body, { headers: new Headers() }),
			async () => post(wave, body, { timestamp: SECONDS - STALE_SECONDS }),
			// Another body than the signed one.
			async () => post(wave, bounced(wave.single.providerId), { headers: await svixHeaders(body) }),
			async () => post(wave, body, { connectionId: withoutSecret }),
		]);

		expect(statuses).toStrictEqual(statuses.map(() => HTTP_UNAUTHORIZED));
		await expect(entryStatus(db, wave.family.id)).resolves.toBe('sent');
	});

	it('answers 400 to a signed body it cannot read, and logs only a code', async () => {
		const wave = await setUpSentWave('resend');
		const errors = vi.spyOn(console, 'error').mockReturnValue();
		const unreadable = [
			'kein JSON',
			JSON.stringify({ data: { email_id: wave.family.providerId }, type: 'email.bounced' }),
			JSON.stringify({ data: {}, type: 'email.complained' }),
		];

		const statuses = await statusesOf(unreadable.map((body) => async () => post(wave, body)));

		expect(statuses).toStrictEqual(unreadable.map(() => HTTP_BAD_REQUEST));
		expect(errors.mock.calls).toStrictEqual(
			unreadable.map(() => ['resend webhook refused', 'webhook.unreadable']),
		);
		await expect(entryStatus(wave.club.db, wave.family.id)).resolves.toBe('sent');
	});

	it('answers 401 to a secret that does not decrypt and writes nothing, however often', async () => {
		const wave = await setUpSentWave('resend');
		const { connectionId, db } = wave.club;
		const errors = vi.spyOn(console, 'error').mockReturnValue();
		// A ciphertext of another row does not decrypt here (its associated data differs).
		const other = await resendConnection(db, wave.club.admin, 'Andere');
		const [moved] = await db
			.select({ secret: mailConnections.webhookSecretCiphertext })
			.from(mailConnections)
			.where(eq(mailConnections.id, other));
		await db
			.update(mailConnections)
			.set({ webhookSecretCiphertext: moved?.secret })
			.where(eq(mailConnections.id, connectionId));
		const before = await writtenState(db);

		const statuses = await statusesOf(
			[1, 2, 3].map(() => async () => post(wave, bounced(wave.family.providerId))),
		);

		expect(statuses).toStrictEqual([HTTP_UNAUTHORIZED, HTTP_UNAUTHORIZED, HTTP_UNAUTHORIZED]);
		// The connection is not disturbed (sending uses the API key), and nothing else changed: no
		// warning, no log entry. The tick step `sendingWarnings` tells the admins once.
		await expect(writtenState(db)).resolves.toStrictEqual(before);
		expect(errors.mock.calls).toStrictEqual(
			statuses.map(() => ['resend webhook secret does not decrypt', 'SecretDecryptError']),
		);
	});

	it('ignores events it does not handle', async () => {
		const wave = await setUpSentWave('resend');
		const delivered = eventOf('email.delivered', wave.family.providerId);
		await expect(post(wave, delivered)).resolves.toBe(HTTP_OK);
		await expect(wave.club.db.$count(webhookEvents)).resolves.toBe(0);
		await expect(entryStatus(wave.club.db, wave.family.id)).resolves.toBe('sent');
	});

	it('logs a soft bounce and records a complaint as an opt-out of the area', async () => {
		const wave = await setUpSentWave('resend');
		const { db, membersAreaId } = wave.club;

		const statuses = await statusesOf([
			async () => post(wave, bounced(wave.single.providerId, 'Transient')),
			async () => post(wave, eventOf('email.complained', wave.family.providerId)),
		]);

		expect(statuses).toStrictEqual([HTTP_OK, HTTP_OK]);
		await expect(entryStatus(db, wave.single.id)).resolves.toBe('sent');
		await expect(db.$count(contactBounces)).resolves.toBe(0);
		await expect(
			db
				.select({ areaId: contactOptOuts.areaId, contactKey: contactOptOuts.contactKey })
				.from(contactOptOuts)
				.orderBy(contactOptOuts.contactKey),
		).resolves.toStrictEqual([
			{ areaId: membersAreaId, contactKey: 'nr:1' },
			{ areaId: membersAreaId, contactKey: 'nr:2' },
		]);
	});
});
