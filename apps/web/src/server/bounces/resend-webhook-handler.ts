/*
 * The webhook of a Resend connection (Design 13, 17): Resend posts bounces and complaints to
 * `/api/webhooks/resend/<connectionId>`, server to server, without cookies and without `Origin`.
 * The route is no server function, so the CSRF check does not apply; the Svix signature with the
 * connection's webhook secret is its protection. No session is read or made.
 *
 * The cheap checks come first (`precheckResendWebhook`, which the route runs before it opens a
 * database): the method (405), the declared size (413), the id and the Svix headers (404, 401).
 * Then the connection (404 unless it is Resend's), its secret (401; a secret that does not decrypt
 * is logged by its code, nothing is written: the tick step `sendingWarnings` tells the admins), the
 * body, read up to 64 KiB (413), the signature and the time (401) and the event (400 for a signed
 * body the app cannot read). Nothing is written before the signature is checked. Each event is
 * processed once (`webhook_events`): a retry or a replay answers 200 and changes nothing. Every
 * answer is empty; a log line names a code, never the body, an address or a secret.
 */
import { eq } from 'drizzle-orm';

import { RESEND_WEBHOOK_PATH } from '@/paths';
import { decryptSecret, SecretDecryptError, secretAad } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { mailConnections, webhookEvents } from '@/server/db/schema';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';
import {
	readResendEvent,
	verifyResendSignature,
	WEBHOOK_MAX_BYTES,
} from '@/server/sending/resend-webhook';
import type { ResendEvent } from '@/server/sending/resend-webhook';

import { recordBounce, recordComplaint } from './bounces';

/** What the webhook needs: the database, the environment, the key of the secrets and the clock. */
interface WebhookDeps {
	readonly db: Db;
	readonly env: Env;
	/** The key of the stored secrets (`deriveSecretsKey`). */
	readonly key: CryptoKey;
	readonly now: () => Date;
}

/** A body grew past `WEBHOOK_MAX_BYTES` while it was read. */
class BodyTooLargeError extends Error {
	public constructor() {
		super('The body is too large.');
		this.name = 'BodyTooLargeError';
	}
}

/** A body within the bound, or why it is none. */
type ReadBody = { readonly text: string } | 'tooLarge' | 'unreadable';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_SERVER_ERROR = 500;

const SVIX_HEADERS = ['svix-id', 'svix-signature', 'svix-timestamp'] as const;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
const DIGITS = /^\d+$/u;
const PREFIX = `${RESEND_WEBHOOK_PATH}/`;

/**
 * An empty answer.
 *
 * @param status The status.
 * @param headers Headers to send along.
 * @returns The response.
 */
function empty(status: number, headers?: Readonly<Record<string, string>>): Response {
	return new Response(null, { headers, status });
}

/**
 * The connection a request is for: the last part of its path.
 *
 * @param url The URL of the request.
 * @returns The id, or null when the path holds none.
 */
function connectionIdOf(url: string): string | null {
	const { pathname } = new URL(url);
	if (!pathname.startsWith(PREFIX)) return null;
	const id = pathname.slice(PREFIX.length);
	return UUID.test(id) ? id.toLowerCase() : null;
}

/**
 * Whether the declared length of a body is above the bound (or no number at all).
 *
 * @param declared The `Content-Length`, or null without one.
 * @returns True when the request is refused for its size before it is read.
 */
function declaredTooLarge(declared: string | null): boolean {
	return declared !== null && !(DIGITS.test(declared) && Number(declared) <= WEBHOOK_MAX_BYTES);
}

/**
 * Reads a stream as UTF-8 text until it ends or has more bytes than `WEBHOOK_MAX_BYTES`.
 *
 * @param reader The reader of the stream.
 * @returns The text.
 * @throws {BodyTooLargeError} As soon as the bound is passed.
 * @throws {Error} When the stream breaks off.
 */
async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = '';
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- a stream is read one chunk after the other
		const { done, value } = await reader.read();
		if (done) return text + decoder.decode();
		bytes += value.byteLength;
		if (bytes > WEBHOOK_MAX_BYTES) throw new BodyTooLargeError();
		text += decoder.decode(value, { stream: true });
	}
}

/**
 * Reads a body up to `WEBHOOK_MAX_BYTES`; past it the stream is cancelled, not read to its end.
 *
 * @param body The stream of the request, or null.
 * @returns The text (UTF-8), `tooLarge`, or `unreadable` when the stream broke off.
 */
async function readBounded(body: ReadableStream<Uint8Array> | null): Promise<ReadBody> {
	if (body === null) return { text: '' };
	const reader = body.getReader();
	try {
		return { text: await readText(reader) };
	} catch (error) {
		if (!(error instanceof BodyTooLargeError)) return 'unreadable';
		await reader.cancel();
		return 'tooLarge';
	}
}

/**
 * The webhook secret of a Resend connection.
 *
 * @param deps The database and the key.
 * @param connectionId The connection.
 * @returns The secret; a status when there is no Resend connection with a usable secret.
 */
async function webhookSecretOf(
	deps: Readonly<WebhookDeps>,
	connectionId: string,
): Promise<{ readonly secret: string } | number> {
	const [row] = await deps.db
		.select({
			ciphertext: mailConnections.webhookSecretCiphertext,
			id: mailConnections.id,
			kind: mailConnections.kind,
		})
		.from(mailConnections)
		.where(eq(mailConnections.id, connectionId));
	if (row?.kind !== 'resend') return HTTP_NOT_FOUND;
	if (row.ciphertext === null) return HTTP_UNAUTHORIZED;
	try {
		const aad = secretAad('mail_connections', row.id, 'webhook_secret_ciphertext');
		return { secret: await decryptSecret(row.ciphertext, deps.key, aad) };
	} catch (error) {
		if (!(error instanceof SecretDecryptError)) throw error;
		// Nothing is written before a signature was checked (ruling R16): the connection is not
		// disturbed (sending uses the API key); `sendingWarnings` tells the admins once.
		// oxlint-disable-next-line no-console -- the label only
		console.error('resend webhook secret does not decrypt', errorLabel(error));
		return HTTP_UNAUTHORIZED;
	}
}

/**
 * Applies an event once: a bounce or a complaint whose Svix id is new.
 *
 * @param deps The database and the clock.
 * @param event The bounce or the complaint.
 */
async function applyOnce(
	deps: Readonly<WebhookDeps>,
	event: Exclude<ResendEvent, { type: 'other' }>,
): Promise<void> {
	const at = deps.now();
	await deps.db.transaction(async (tx) => {
		const fresh = await tx
			.insert(webhookEvents)
			.values({ id: event.id, receivedAt: at })
			.onConflictDoNothing()
			.returning({ id: webhookEvents.id });
		if (fresh.length === 0) return;
		if (event.type === 'complaint') {
			await recordComplaint(tx, event.emailId, at);
			return;
		}
		const entry = { providerId: event.emailId };
		await recordBounce(tx, { at, entry, hard: event.hard, source: 'resend' });
	});
}

/**
 * Answers a body read within the bound: its signature, its time and its event.
 *
 * @param secret The webhook secret of the connection.
 * @param request The request, for its Svix headers.
 * @param body The raw body.
 * @param deps The database and the clock.
 * @returns The response.
 */
// oxlint-disable-next-line max-params -- the secret, the request, its body and the deps
async function answerBody(
	secret: string,
	request: Request,
	body: string,
	deps: Readonly<WebhookDeps>,
): Promise<Response> {
	const id = await verifyResendSignature(secret, request.headers, body, deps.now());
	if (id === null) return empty(HTTP_UNAUTHORIZED);
	const event = readResendEvent(id, body);
	if (event === null) {
		// oxlint-disable-next-line no-console -- a code only, never the body
		console.error('resend webhook refused', 'webhook.unreadable');
		return empty(HTTP_BAD_REQUEST);
	}
	if (event.type !== 'other') await applyOnce(deps, event);
	return empty(HTTP_OK);
}

/**
 * Answers a request whose connection, size and headers passed the first checks.
 *
 * @param request The request.
 * @param connectionId The connection.
 * @param deps The database, the environment, the key and the clock.
 * @returns The response.
 */
async function answerVerified(
	request: Request,
	connectionId: string,
	deps: Readonly<WebhookDeps>,
): Promise<Response> {
	const secret = await webhookSecretOf(deps, connectionId);
	if (typeof secret === 'number') return empty(secret);
	const body = await readBounded(request.body);
	if (body === 'tooLarge') return empty(HTTP_PAYLOAD_TOO_LARGE);
	if (body === 'unreadable') return empty(HTTP_BAD_REQUEST);
	return answerBody(secret.secret, request, body.text, deps);
}

/**
 * The checks that need no database: the method, the declared size, the connection id and the
 * Svix headers. The route runs them before it opens a database, so a stray request costs none.
 *
 * @param request The request.
 * @returns The refusal (405, 413, 404 or 401), or the connection id of a request that passed.
 */
async function precheckResendWebhook(
	request: Request,
): Promise<Response | { connectionId: string }> {
	if (request.method !== 'POST') return empty(HTTP_METHOD_NOT_ALLOWED, { allow: 'POST' });
	if (declaredTooLarge(request.headers.get('content-length'))) {
		await request.body?.cancel();
		return empty(HTTP_PAYLOAD_TOO_LARGE);
	}
	const connectionId = connectionIdOf(request.url);
	if (connectionId === null) return empty(HTTP_NOT_FOUND);
	if (SVIX_HEADERS.some((name) => (request.headers.get(name) ?? '') === '')) {
		return empty(HTTP_UNAUTHORIZED);
	}
	return { connectionId };
}

/**
 * Answers a POST of Resend's webhook (see the module comment).
 *
 * @param request The request.
 * @param deps The database, the environment, the key of the secrets and the clock.
 * @returns An empty response: 200, 400, 401, 404, 405, 413 or 500.
 */
async function handleResendWebhook(
	request: Request,
	deps: Readonly<WebhookDeps>,
): Promise<Response> {
	const checked = await precheckResendWebhook(request);
	if (checked instanceof Response) return checked;
	try {
		return await answerVerified(request, checked.connectionId, deps);
	} catch (error) {
		// oxlint-disable-next-line no-console -- the label only; Resend retries the event
		console.error('resend webhook failed', errorLabel(error));
		return empty(HTTP_SERVER_ERROR);
	}
}

export { handleResendWebhook, precheckResendWebhook };
export type { WebhookDeps };
