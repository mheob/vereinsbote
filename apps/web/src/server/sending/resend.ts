/*
 * Resend as a mail provider: `POST {api}/emails` with an `Idempotency-Key`. It runs on Node, on
 * Vercel and on Workers: only `fetch`, `TextEncoder` and `btoa`.
 *
 * Resend has no cheap check for keys with "Sending access", so `probe` is `null`: the outbox
 * tries one due entry per run instead. There is no bounce query either (`fetchBounces: null`);
 * bounces arrive by webhook (`resend-webhook.ts`). A send carries an idempotency key, so every
 * retryable outcome is `transient`: Resend never returns `uncertain`.
 *
 * Failures carry fixed codes only: no key, address or message text ever enters a code.
 */

import { z } from 'zod';

import { cleanHeaderText } from '@/mail/escape';
import type { Env } from '@/server/env';
import { assertMailAddress, MimeAddressError } from '@/server/sending/mime';
import { retryAfterMs } from '@/server/sending/transport';
import type {
	OutgoingMail,
	SendFailureClass,
	SendResult,
	Transport,
} from '@/server/sending/transport';

interface ResendDeps {
	readonly fetch: typeof fetch;
	readonly endpoint: string;
	readonly now: () => Date;
}

type Failure = Extract<SendResult, { ok: false }>;

interface Classified {
	readonly failure: SendFailureClass;
	readonly code: string;
}

const DEFAULT_ENDPOINT = 'https://api.resend.com';
const TIMEOUT_MS = 30_000;
const HTTP_OK = 200;
const HTTP_MULTIPLE_CHOICES = 300;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_EARLY = 425;
const HTTP_TOO_MANY = 429;
// Request timeout and too early: sending again is safe with the idempotency key.
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([HTTP_REQUEST_TIMEOUT, HTTP_TOO_EARLY]);
const HTTP_SERVER_ERROR = 500;
const BASE64_CHUNK = 0x60_00;
const TRAILING_SLASHES = /\/+$/u;
const FIRST_PRINTABLE = 33;
const LAST_PRINTABLE = 126;
const MAX_KEY_LENGTH = 256;

/*
 * The `name` of an error body decides the class (checked against
 * https://resend.com/docs/api-reference/errors on 2026-11-25). A name not in the table falls
 * back to the status: 401/403 `unauthorized`, 5xx and 429 `transient`, any other 4xx `rejected`.
 */
const ERROR_NAMES: ReadonlyMap<string, Classified> = new Map<string, Classified>([
	['application_error', { code: 'resend.server', failure: 'transient' }],
	['concurrent_idempotent_requests', { code: 'resend.concurrent', failure: 'transient' }],
	['daily_quota_exceeded', { code: 'resend.quota', failure: 'quota' }],
	['dns_lookup_failed', { code: 'resend.server', failure: 'transient' }],
	['invalid_attachment', { code: 'resend.rejected', failure: 'rejected' }],
	['invalid_idempotency_key', { code: 'resend.idempotency', failure: 'rejected' }],
	['invalid_idempotent_request', { code: 'resend.idempotency', failure: 'rejected' }],
	['invalid_parameter', { code: 'resend.rejected', failure: 'rejected' }],
	['invalid_permission', { code: 'resend.unauthorized', failure: 'unauthorized' }],
	['missing_api_key', { code: 'resend.unauthorized', failure: 'unauthorized' }],
	['missing_required_field', { code: 'resend.rejected', failure: 'rejected' }],
	['missing_required_parameter', { code: 'resend.rejected', failure: 'rejected' }],
	['monthly_quota_exceeded', { code: 'resend.quota', failure: 'quota' }],
	['not_found', { code: 'resend.rejected', failure: 'rejected' }],
	['rate_limit_exceeded', { code: 'resend.throttled', failure: 'transient' }],
	['restricted_api_key', { code: 'resend.unauthorized', failure: 'unauthorized' }],
	['service_unavailable', { code: 'resend.server', failure: 'transient' }],
	['suspended_api_key', { code: 'resend.unauthorized', failure: 'unauthorized' }],
]);

const errorSchema = z.object({ name: z.string() });
const successSchema = z.object({ id: z.string().min(1) });

function fail(failure: SendFailureClass, code: string, wait: number | null = null): Failure {
	return { code, failure, ok: false, retryAfterMs: wait };
}

/**
 * The Resend API address (decision 9).
 *
 * @param env The environment; `devProvidersUrl` points it at the local provider server.
 * @returns The base address without a trailing slash.
 */
function resendEndpoint(env: Pick<Env, 'devProvidersUrl'>): string {
	if (env.devProvidersUrl === null) return DEFAULT_ENDPOINT;
	return `${env.devProvidersUrl.href.replace(TRAILING_SLASHES, '')}/resend`;
}

function classifyByStatus(status: number): Classified {
	if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
		return { code: 'resend.unauthorized', failure: 'unauthorized' };
	}
	if (status >= HTTP_SERVER_ERROR) return { code: 'resend.server', failure: 'transient' };
	if (RETRYABLE_STATUS.has(status)) return { code: 'resend.server', failure: 'transient' };
	if (status === HTTP_TOO_MANY) return { code: 'resend.throttled', failure: 'transient' };
	return { code: 'resend.rejected', failure: 'rejected' };
}

/**
 * Classifies the answer of `POST /emails`. Every retryable outcome is `transient`, because the
 * request carries an idempotency key.
 *
 * @param status The HTTP status.
 * @param body The parsed JSON body (any shape; only `id` and `name` are read).
 * @param headers The response headers (`Retry-After`).
 * @param now The current time.
 * @returns Success, or the failure class with a fixed code.
 */
// oxlint-disable-next-line max-params -- the signature is fixed by the plan; tests and callers pass the four values
function classifyResendResponse(
	status: number,
	body: unknown,
	headers: Headers,
	now: Date,
): SendResult {
	if (status >= HTTP_OK && status < HTTP_MULTIPLE_CHOICES) {
		const parsed = successSchema.safeParse(body);
		return { ok: true, providerId: parsed.success ? parsed.data.id : null };
	}
	const name = errorSchema.safeParse(body);
	const byName = name.success ? ERROR_NAMES.get(name.data.name) : undefined;
	// A 401/403 stays `unauthorized` even under a name such as `validation_error` (restrictions).
	const byStatus = classifyByStatus(status);
	const picked = byName ?? byStatus;
	const wait = picked.failure === 'transient' ? retryAfterMs(headers, now) : null;
	return fail(picked.failure, picked.code, wait);
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
		binary += String.fromCodePoint(...bytes.subarray(offset, offset + BASE64_CHUNK));
	}
	return btoa(binary);
}

function fromField(from: OutgoingMail['from']): string {
	const address = assertMailAddress(from.address);
	const name = cleanHeaderText(from.name).replaceAll('"', "'");
	return name === '' ? address : `"${name}" <${address}>`;
}

// Visible ASCII only: no space, no CR or LF, no other control character.
function isPrintable(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.codePointAt(index) ?? 0;
		if (code < FIRST_PRINTABLE || code > LAST_PRINTABLE) return false;
	}
	return true;
}

function printable(value: string): string {
	if (value === '' || !isPrintable(value)) throw new MimeAddressError();
	return value;
}

function buildPayload(mail: Readonly<OutgoingMail>): Record<string, unknown> {
	const headers: Record<string, string> = { 'Message-ID': printable(mail.messageId) };
	if (mail.listUnsubscribe !== null) {
		headers['List-Unsubscribe'] = `<${assertMailAddress(mail.listUnsubscribe)}>`;
		headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
	}
	return {
		attachments: mail.attachments.map((file) => ({
			content: toBase64(file.bytes),
			content_type: file.contentType,
			filename: cleanHeaderText(file.filename),
		})),
		...(mail.kind === 'regular' && mail.bcc !== null ? { bcc: [assertMailAddress(mail.bcc)] } : {}),
		from: fromField(mail.from),
		headers,
		html: mail.html,
		...(mail.replyTo === null ? {} : { reply_to: assertMailAddress(mail.replyTo) }),
		subject: cleanHeaderText(mail.subject),
		text: mail.text,
		to: [assertMailAddress(mail.to)],
	};
}

async function readJson(response: Response): Promise<unknown> {
	try {
		return (await response.json()) as unknown;
	} catch {
		return null;
	}
}

type Built =
	| { readonly ok: true; readonly body: string; readonly headers: Record<string, string> }
	| { readonly ok: false; readonly failure: Failure };

function buildRequest(apiKey: string, mail: Readonly<OutgoingMail>): Built {
	const key = mail.idempotencyKey;
	if (key !== null && (key.length > MAX_KEY_LENGTH || !isPrintable(key) || key === '')) {
		return { failure: fail('rejected', 'resend.idempotency'), ok: false };
	}
	try {
		return {
			body: JSON.stringify(buildPayload(mail)),
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
				...(key === null ? {} : { 'idempotency-key': key }),
			},
			ok: true,
		};
	} catch (error) {
		if (error instanceof MimeAddressError) {
			return { failure: fail('rejected', 'mime.address'), ok: false };
		}
		throw error;
	}
}

interface Request {
	readonly body: string;
	readonly headers: Readonly<Record<string, string>>;
}

async function post(deps: ResendDeps, request: Readonly<Request>): Promise<Response | null> {
	try {
		return await deps.fetch(`${deps.endpoint}/emails`, {
			body: request.body,
			headers: request.headers,
			method: 'POST',
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch {
		return null;
	}
}

/**
 * A Resend transport. The key lives inside the object, never in a module.
 *
 * @param apiKey The API key.
 * @param deps `fetch`, the endpoint and the clock.
 * @returns A transport without `probe` and without `fetchBounces`.
 */
function createResendTransport(apiKey: string, deps: ResendDeps): Transport {
	async function send(mail: Readonly<OutgoingMail>): Promise<SendResult> {
		const built = buildRequest(apiKey, mail);
		if (!built.ok) return built.failure;
		const response = await post(deps, built);
		if (response === null) return fail('transient', 'resend.network');
		const body = await readJson(response);
		return classifyResendResponse(response.status, body, response.headers, deps.now());
	}

	return { fetchBounces: null, probe: null, send };
}

export { classifyResendResponse, createResendTransport, resendEndpoint };
export type { ResendDeps };
