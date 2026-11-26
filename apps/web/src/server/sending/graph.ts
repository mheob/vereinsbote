/*
 * Microsoft Graph as a mail provider: client-credentials token, `sendMail` (MIME for regular mail,
 * JSON for system mail), bounce reports from the inbox and the restriction probe. It runs on Node,
 * on Vercel and on Workers: only `fetch`, `TextEncoder` and `btoa`.
 *
 * The token lives inside one transport object (one tick run or one request), never in a module.
 * Failures carry fixed codes only: no secret, token or address ever enters a code or a message.
 */

import { z } from 'zod';

import { isSubrequestLimit, SUBREQUEST_LIMIT_CODE } from '@/platform/subrequests';
import type { Env } from '@/server/env';
import {
	buildMime,
	GRAPH_REQUEST_LIMIT_BYTES,
	graphRequestBytes,
	MimeAddressError,
} from '@/server/sending/mime';
import { retryAfterMs } from '@/server/sending/transport';
import type { BounceReport, OutgoingMail, SendResult, Transport } from '@/server/sending/transport';

interface GraphSettings {
	readonly tenantId: string;
	readonly clientId: string;
	readonly clientSecret: string;
}

interface GraphEndpoints {
	readonly login: string;
	readonly graph: string;
}

interface GraphDeps {
	readonly fetch: typeof fetch;
	readonly endpoints: GraphEndpoints;
	readonly now: () => Date;
}

type RestrictionResult = 'restricted' | 'readable' | 'unknown';

type Failure = Extract<SendResult, { ok: false }>;

interface CallInit {
	readonly method: 'GET' | 'POST';
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string | null;
}

type TokenResult =
	| { readonly ok: true; readonly value: string }
	| { readonly ok: false; readonly failure: Failure };

interface Session {
	readonly token: () => Promise<TokenResult>;
}

/**
 * What a call came to: the response, `unsent` when the platform refused to make the request (the
 * subrequest limit of a Worker), or `lost` when it went out and broke off (a time-out, a network
 * error).
 */
type Called = Response | 'lost' | 'unsent';

type Prepared =
	| { readonly body: string; readonly contentType: string }
	| { readonly failure: Failure };

interface MessageHeader {
	readonly name: string;
	readonly value: string;
}

const DEFAULT_ENDPOINTS: GraphEndpoints = {
	graph: 'https://graph.microsoft.com/v1.0',
	login: 'https://login.microsoftonline.com',
};
const SCOPE = 'https://graph.microsoft.com/.default';
const TIMEOUT_MS = 30_000;
const TOKEN_MARGIN_MS = 60_000;
const MS_PER_SECOND = 1000;
const NDR_CLASS = 'REPORT.IPM.Note.NDR';
const EPOCH = new Date(0);
const LAST = -1;
const HTTP_OK = 200;
const HTTP_MULTIPLE_CHOICES = 300;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_LARGE = 413;
const HTTP_THROTTLED = 429;
const HTTP_SERVER_ERROR = 500;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_UNAVAILABLE = 503;
const WAIT_CODES = new Map([
	[HTTP_REQUEST_TIMEOUT, 'graph.network'],
	[HTTP_THROTTLED, 'graph.throttled'],
	[HTTP_UNAVAILABLE, 'graph.server'],
]);
const WAIT_AND_RETRY = new Set(WAIT_CODES.keys());
const DEFAULT_TOKEN_SECONDS = 300;
const BASE64_CHUNK = 0x60_00;

const encoder = new TextEncoder();
const RECIPIENT_CODE = /recipient|address/iu;
const STATUS_LINE = /^Status:[ \t]*(?<class>[45])\.\d{1,3}\.\d{1,3}\b/imu;
const SMTP_REPLY = /\b[45]\d{2}[ \t]+(?<class>[45])\.\d{1,3}\.\d{1,3}\b/u;
const ANY_STATUS = /(?<![\d.])(?<class>[45])\.\d{1,3}\.\d{1,3}(?![\d.])/u;
const QUOTED_MESSAGE_ID = /^Message-ID:[ \t]*(?<id><[^<>\s]{1,998}>)/imu;
const ANGLE_ID = /<[^<>\s]{1,998}>/gu;

const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const headerSchema = z.object({ name: z.string(), value: z.string() });
const messageSchema = z.object({
	body: z.object({ content: z.string() }).optional(),
	bodyPreview: z.string().optional(),
	id: z.string().min(1),
	internetMessageHeaders: z.array(headerSchema).optional(),
	receivedDateTime: z.string(),
});
const listSchema = z.object({ value: z.array(z.unknown()) });
const tokenSchema = z.object({
	access_token: z.string().min(1),
	expires_in: z.coerce.number().optional(),
});
const receivedSchema = z.object({ receivedDateTime: z.string() });

function withoutTrailingSlashes(text: string): string {
	let end = text.length;
	while (end > 0 && text[end - 1] === '/') end -= 1;
	return text.slice(0, end);
}

function fail(failure: Failure['failure'], code: string, wait: number | null = null): Failure {
	return { code, failure, ok: false, retryAfterMs: wait };
}

/**
 * The login and Graph addresses (decision 8).
 *
 * @param env The environment; `devProvidersUrl` points both at the local provider server.
 * @returns The two base addresses without a trailing slash.
 */
function graphEndpoints(env: Pick<Env, 'devProvidersUrl'>): GraphEndpoints {
	if (env.devProvidersUrl === null) return DEFAULT_ENDPOINTS;
	const base = withoutTrailingSlashes(env.devProvidersUrl.href);
	return { graph: `${base}/graph/v1.0`, login: `${base}/login` };
}

// Graph did not accept the mail (429, 503, 408): sending it again is safe.
function waitAndRetry(status: number, headers: Headers, now: Date): Failure {
	const code = WAIT_CODES.get(status) ?? 'graph.server';
	return fail('transient', code, retryAfterMs(headers, now));
}

function classifyClientError(status: number, body: unknown): Failure {
	// The token came, so a 403 or 404 is about the mailbox: outside the scope the app may use
	// (RBAC for Applications) or not there at all.
	if (status === HTTP_FORBIDDEN || status === HTTP_NOT_FOUND) {
		return fail('unauthorized', 'graph.mailbox');
	}
	if (status === HTTP_TOO_LARGE) return fail('rejected', 'graph.tooLarge');
	const parsed = errorSchema.safeParse(body);
	const code = parsed.success ? parsed.data.error.code : '';
	return fail('rejected', RECIPIENT_CODE.test(code) ? 'graph.recipient' : 'graph.rejected');
}

/**
 * Classifies the answer of `sendMail`. A 5xx other than 503 is `uncertain`: the request went out
 * and Graph may still have sent the mail, so it is never resent automatically. A 401 refuses the
 * token (`graph.unauthorized`); a 403 or 404 refuses the mailbox (`graph.mailbox`).
 *
 * @param status The HTTP status.
 * @param body The parsed JSON body (any shape; only `error.code` is read).
 * @param headers The response headers (`Retry-After`).
 * @param now The current time.
 * @returns Success, or the failure class with a fixed code.
 */
// oxlint-disable-next-line max-params -- the signature is fixed by the plan; tests and callers pass the four values
function classifyGraphResponse(
	status: number,
	body: unknown,
	headers: Headers,
	now: Date,
): SendResult {
	if (status >= HTTP_OK && status < HTTP_MULTIPLE_CHOICES) return { ok: true, providerId: null };
	if (status === HTTP_UNAUTHORIZED) return fail('unauthorized', 'graph.unauthorized');
	if (WAIT_AND_RETRY.has(status)) return waitAndRetry(status, headers, now);
	if (status >= HTTP_SERVER_ERROR) return fail('uncertain', 'graph.server');
	return classifyClientError(status, body);
}

function headerValue(headers: readonly MessageHeader[], name: string): string {
	const wanted = name.toLowerCase();
	return headers.find((header) => header.name.toLowerCase() === wanted)?.value ?? '';
}

function originalMessageId(headers: readonly MessageHeader[], text: string): string | null {
	const replyTo = headerValue(headers, 'in-reply-to').match(ANGLE_ID)?.[0];
	if (replyTo !== undefined) return replyTo;
	const references = headerValue(headers, 'references').match(ANGLE_ID);
	if (references !== null) return references.at(LAST) ?? null;
	return QUOTED_MESSAGE_ID.exec(text)?.groups?.id ?? null;
}

function statusClass(text: string): string | undefined {
	return (STATUS_LINE.exec(text) ?? SMTP_REPLY.exec(text) ?? ANY_STATUS.exec(text))?.groups?.class;
}

/**
 * Reads a bounce report (a delivery status notification) from a Graph message.
 *
 * @param message A message as the Graph returns it (any shape).
 * @returns The report, or `null` when no status code, original Message-ID or date can be read.
 */
function parseNdr(message: unknown): BounceReport | null {
	const parsed = messageSchema.safeParse(message);
	if (!parsed.success) return null;
	const { body, bodyPreview, id, internetMessageHeaders, receivedDateTime } = parsed.data;
	const text = `${body?.content ?? ''}\n${bodyPreview ?? ''}`;
	const status = statusClass(text);
	const original = originalMessageId(internetMessageHeaders ?? [], text);
	const received = new Date(receivedDateTime);
	if (status === undefined || original === null || Number.isNaN(received.getTime())) return null;
	return { hard: status === '5', originalMessageId: original, receivedAt: received, reportId: id };
}

/**
 * The address of the bounce query: reports of the inbox since a date, oldest first, so that the
 * latest date seen is a safe cursor.
 *
 * @param mailboxPath The mailbox address (`{graph}/users/{mailbox}`, see `mailboxUrl`).
 * @param since Only reports received at or after this time; `null` for all.
 * @param limit The most messages to return.
 * @returns The full URL.
 */
function inboxBouncesUrl(mailboxPath: string, since: Date | null, limit: number): string {
	const filter =
		`receivedDateTime ge ${(since ?? EPOCH).toISOString()} and ` +
		`singleValueExtendedProperties/any(ep: ep/id eq 'String 0x001A' and ep/value eq '${NDR_CLASS}')`;
	const expand = "singleValueExtendedProperties($filter=id eq 'String 0x001A')";
	const select = 'id,receivedDateTime,internetMessageHeaders,body,bodyPreview';
	const query = [
		`$filter=${encodeURIComponent(filter)}`,
		`$expand=${encodeURIComponent(expand)}`,
		`$select=${encodeURIComponent(select)}`,
		`$orderby=${encodeURIComponent('receivedDateTime asc')}`,
		`$top=${limit}`,
	].join('&');
	return `${mailboxPath}/mailFolders/inbox/messages?${query}`;
}

function mailboxUrl(endpoints: GraphEndpoints, mailbox: string): string {
	return `${endpoints.graph}/users/${encodeURIComponent(mailbox)}`;
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
		binary += String.fromCodePoint(...bytes.subarray(offset, offset + BASE64_CHUNK));
	}
	return btoa(binary);
}

async function readJson(response: Response): Promise<unknown> {
	try {
		return (await response.json()) as unknown;
	} catch {
		return null;
	}
}

async function callWithTimeout(deps: GraphDeps, url: string, init: CallInit): Promise<Called> {
	try {
		return await deps.fetch(url, {
			body: init.body ?? undefined,
			headers: init.headers,
			method: init.method,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (error) {
		return isSubrequestLimit(error) ? 'unsent' : 'lost';
	}
}

/**
 * The failure of a call that brought no response.
 *
 * @param called What the call came to.
 * @param lost The class of a request that went out and broke off.
 * @returns `transient` with `platform.subrequests` when the request never left, else `lost` with
 *   `graph.network`.
 */
function noResponse(called: 'lost' | 'unsent', lost: Failure['failure']): Failure {
	return called === 'unsent'
		? fail('transient', SUBREQUEST_LIMIT_CODE)
		: fail(lost, 'graph.network');
}

/**
 * The response of a call that is not about sending, where a call without one is a failure.
 *
 * @param called What the call came to.
 * @returns The response.
 * @throws {Error} With the code of the call that brought none.
 */
function responseOf(called: Called): Response {
	if (called instanceof Response) return called;
	throw new Error(noResponse(called, 'transient').code);
}

// Releases the connection of a response whose body nobody reads.
async function drain(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// The body is already gone; nothing to release.
	}
}

function tokenFailure(response: Response, now: Date): TokenResult {
	const { status } = response;
	if (status === HTTP_THROTTLED || status >= HTTP_SERVER_ERROR) {
		return { failure: waitAndRetry(status, response.headers, now), ok: false };
	}
	return { failure: fail('unauthorized', 'graph.unauthorized'), ok: false };
}

async function requestToken(
	settings: GraphSettings,
	deps: GraphDeps,
): Promise<TokenResult & { readonly lifetimeMs?: number }> {
	const response = await callWithTimeout(
		deps,
		`${deps.endpoints.login}/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/token`,
		{
			body: new URLSearchParams({
				client_id: settings.clientId,
				client_secret: settings.clientSecret,
				grant_type: 'client_credentials',
				scope: SCOPE,
			}).toString(),
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			method: 'POST',
		},
	);
	if (typeof response === 'string')
		return { failure: noResponse(response, 'transient'), ok: false };
	if (!response.ok) return tokenFailure(response, deps.now());
	const parsed = tokenSchema.safeParse(await readJson(response));
	if (!parsed.success) return { failure: fail('transient', 'graph.server'), ok: false };
	const lifetimeMs =
		(parsed.data.expires_in ?? DEFAULT_TOKEN_SECONDS) * MS_PER_SECOND - TOKEN_MARGIN_MS;
	return { lifetimeMs, ok: true, value: parsed.data.access_token };
}

function createSession(settings: GraphSettings, deps: GraphDeps): Session {
	let cached: { readonly value: string; readonly expiresAt: number } | null = null;
	let pending: Promise<TokenResult> | null = null;

	async function fetchToken(): Promise<TokenResult> {
		try {
			const result = await requestToken(settings, deps);
			if (result.ok) {
				const lifetime = result.lifetimeMs ?? 0;
				cached = { expiresAt: deps.now().getTime() + lifetime, value: result.value };
			}
			return result;
		} finally {
			pending = null;
		}
	}

	return {
		token: async () => {
			if (cached !== null && deps.now().getTime() < cached.expiresAt) {
				return { ok: true, value: cached.value };
			}
			// Concurrent sends share one token request.
			pending ??= fetchToken();
			return pending;
		},
	};
}

function recipient(address: string): { emailAddress: { address: string } } {
	return { emailAddress: { address } };
}

function systemPayload(mail: Readonly<OutgoingMail>): string {
	return JSON.stringify({
		message: {
			bccRecipients: mail.bcc === null ? [] : [recipient(mail.bcc)],
			body: { content: mail.html, contentType: 'HTML' },
			replyTo: mail.replyTo === null ? [] : [recipient(mail.replyTo)],
			subject: mail.subject,
			toRecipients: [recipient(mail.to)],
		},
		saveToSentItems: false,
	});
}

function mimeRequest(mail: Readonly<OutgoingMail>, now: Date): Prepared {
	if (graphRequestBytes(mail, now) > GRAPH_REQUEST_LIMIT_BYTES) {
		return { failure: fail('rejected', 'graph.tooLarge') };
	}
	return { body: toBase64(encoder.encode(buildMime(mail, now))), contentType: 'text/plain' };
}

function prepare(mail: Readonly<OutgoingMail>, now: Date): Prepared {
	if (mail.kind === 'system') {
		return { body: systemPayload(mail), contentType: 'application/json' };
	}
	try {
		return mimeRequest(mail, now);
	} catch (error) {
		if (error instanceof MimeAddressError) return { failure: fail('rejected', 'mime.address') };
		throw error;
	}
}

function failureCode(result: Readonly<SendResult>): string {
	return result.ok ? 'graph.unknown' : result.code;
}

function receivedTime(message: unknown): number {
	const parsed = receivedSchema.safeParse(message);
	return parsed.success ? new Date(parsed.data.receivedDateTime).getTime() : Number.NaN;
}

function collectBounces(json: unknown): { reports: BounceReport[]; until: Date | null } {
	const parsed = listSchema.safeParse(json);
	if (!parsed.success) throw new Error('graph.response');
	const messages = parsed.data.value;
	const reports = messages
		.map((message) => parseNdr(message))
		.filter((report): report is BounceReport => report !== null);
	const times = messages
		.map((message) => receivedTime(message))
		.filter((time) => !Number.isNaN(time));
	return { reports, until: times.length === 0 ? null : new Date(Math.max(...times)) };
}

/**
 * Makes the Graph transport of one mailbox. Its token lives as long as the object.
 *
 * @param settings The app registration.
 * @param mailbox The sending mailbox.
 * @param deps `fetch`, the endpoints and the clock.
 * @returns The transport.
 */
function createGraphTransport(
	settings: GraphSettings,
	mailbox: string,
	deps: GraphDeps,
): Transport {
	const session = createSession(settings, deps);
	const base = mailboxUrl(deps.endpoints, mailbox);

	async function send(mail: Readonly<OutgoingMail>): Promise<SendResult> {
		const prepared = prepare(mail, deps.now());
		if ('failure' in prepared) return prepared.failure;
		const token = await session.token();
		if (!token.ok) return token.failure;
		const response = await callWithTimeout(deps, `${base}/sendMail`, {
			body: prepared.body,
			headers: { authorization: `Bearer ${token.value}`, 'content-type': prepared.contentType },
			method: 'POST',
		});
		// The request was issued: after a time-out or a network error the mail may be on its way.
		if (typeof response === 'string') return noResponse(response, 'uncertain');
		if (response.ok) await drain(response);
		const body = response.ok ? null : await readJson(response);
		return classifyGraphResponse(response.status, body, response.headers, deps.now());
	}

	/*
	 * `receivedDateTime ge since` returns the reports of the boundary second again: the caller
	 * (Task 19) dedups by report id. Dates have second precision, so a caller must pick a limit
	 * well above any burst of reports within one second, or the cursor cannot move past it.
	 */
	async function fetchBounces(
		since: Date | null,
		limit: number,
	): Promise<{ reports: BounceReport[]; until: Date | null }> {
		const token = await session.token();
		if (!token.ok) throw new Error(token.failure.code);
		const called = await callWithTimeout(deps, inboxBouncesUrl(base, since, limit), {
			body: null,
			headers: {
				authorization: `Bearer ${token.value}`,
				prefer: 'outlook.body-content-type="text"',
			},
			method: 'GET',
		});
		const response = responseOf(called);
		if (!response.ok) {
			const failure = classifyGraphResponse(response.status, null, response.headers, deps.now());
			throw new Error(failureCode(failure));
		}
		return collectBounces(await readJson(response));
	}

	return {
		fetchBounces,
		probe: async () => {
			const token = await session.token();
			return token.ok ? { ok: true, providerId: null } : token.failure;
		},
		send,
	};
}

/**
 * Tests whether an application access policy restricts the app to some mailboxes: a mailbox that
 * should be out of scope answers 403.
 *
 * @param settings The app registration.
 * @param probeMailbox A mailbox that the policy should exclude.
 * @param deps `fetch`, the endpoints and the clock.
 * @returns `restricted` on 403, `readable` on 200, otherwise `unknown`.
 */
async function checkMailboxRestriction(
	settings: GraphSettings,
	probeMailbox: string,
	deps: GraphDeps,
): Promise<RestrictionResult> {
	const session = createSession(settings, deps);
	const token = await session.token();
	if (!token.ok) return 'unknown';
	const response = await callWithTimeout(
		deps,
		`${mailboxUrl(deps.endpoints, probeMailbox)}/messages?$top=1`,
		{
			body: null,
			headers: { authorization: `Bearer ${token.value}` },
			method: 'GET',
		},
	);
	if (typeof response === 'string') return 'unknown';
	await drain(response);
	if (response.status === HTTP_FORBIDDEN) return 'restricted';
	return response.status === HTTP_OK ? 'readable' : 'unknown';
}

export {
	checkMailboxRestriction,
	classifyGraphResponse,
	createGraphTransport,
	graphEndpoints,
	inboxBouncesUrl,
	mailboxUrl,
	parseNdr,
};
export type { GraphDeps, GraphEndpoints, GraphSettings, RestrictionResult };
