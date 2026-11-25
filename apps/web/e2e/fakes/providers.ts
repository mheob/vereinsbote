/* oxlint-disable typescript/prefer-readonly-parameter-types, max-statements -- node:http requests and responses are mutable handles, and the route handlers are flat dispatch code of a dev fake */
/*
 * A local stand-in for Microsoft Graph and Resend, for the sending e2e tests and for development
 * (`vp run --filter web dev:providers`, port 3200). The app reaches it through `DEV_PROVIDERS_URL`.
 *
 * It runs as plain `node e2e/fakes/providers.ts`: only erasable TypeScript, only `node:*` modules
 * and `nodemailer`, no `@/` imports. Accepted mail is handed to `deliver` (by default: SMTP to the
 * local Mailpit). Every secret is accepted except `wrong-secret` (401). Graph reads of a mailbox
 * that is not in the `senders` list answer 403, so the restriction check can tell "restricted"; the
 * one exception is `readable@verein.test`, which is readable (the warning case).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { createTransport } from 'nodemailer';

interface Envelope {
	readonly from: string;
	readonly to: string[];
}

interface FakeProvidersOptions {
	readonly port: number;
	readonly deliver: (mime: string, envelope: Readonly<Envelope>) => Promise<void>;
}

interface RecordedRequest {
	readonly method: string;
	readonly path: string;
	readonly savedToSentItems?: boolean;
}

interface NdrMessage {
	readonly id: string;
	readonly receivedDateTime: string;
	readonly internetMessageHeaders: { name: string; value: string }[];
	readonly body: { content: string };
	readonly bodyPreview: string;
}

type Json = Record<string, unknown>;

const TOKEN_PREFIX = 'Bearer ';
const WRONG_SECRET = 'wrong-secret';
const READABLE_MAILBOX = 'readable@verein.test';
const SMTP_HOST = 'localhost';
const SMTP_PORT = 1025;
const MS_PER_SECOND = 1000;
const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const MAX_BODY_CHARS = 1_048_576;
const HTTP_TOO_LARGE = 413;
const LOOPBACK = '127.0.0.1';
const SNIPPET_LENGTH = 255;
const DEFAULT_TOP = 50;
const HEADER_END = /\r?\n\r?\n/u;
const UNFOLD = /\r?\n[ \t]+/gu;
const SECRET_PREFIX = /^whsec_/u;
const TRAILING_SLASHES = /\/+$/u;
const ANGLE_ADDRESS = /<(?<address>[^<>]+)>/u;
const GRAPH_ROUTE = /^\/graph\/v1\.0\/users\/(?<mailbox>[^/]+)\/(?<rest>.+)$/u;
const TOKEN_ROUTE = /^\/login\/[^/]+\/oauth2\/v2\.0\/token$/u;
const NON_ASCII = /[^\u0020-\u007E]/u;
const SINCE = /receivedDateTime ge (?<since>\S+)/u;

class BodyTooLargeError extends Error {
	public constructor() {
		super('fake.bodyTooLarge');
		this.name = 'BodyTooLargeError';
	}
}

async function readBody(request: IncomingMessage): Promise<string> {
	request.setEncoding('utf8');
	let body = '';
	for await (const chunk of request) {
		body += String(chunk);
		if (body.length > MAX_BODY_CHARS) throw new BodyTooLargeError();
	}
	return body;
}

function isRecord(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Any value as an object, so a missing or wrong part reads as empty.
function record(value: unknown): Json {
	return isRecord(value) ? value : {};
}

function parseJson(raw: string): Json {
	try {
		return record(JSON.parse(raw));
	} catch {
		return {};
	}
}

function send(response: ServerResponse, status: number, body?: unknown): void {
	if (body === undefined) {
		response.writeHead(status).end();
		return;
	}
	response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function bearer(request: IncomingMessage): string {
	const header = request.headers.authorization ?? '';
	return header.startsWith(TOKEN_PREFIX) ? header.slice(TOKEN_PREFIX.length) : '';
}

function asText(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function unfoldedHeaders(mime: string): Map<string, string> {
	const head = mime.split(HEADER_END)[0] ?? '';
	const headers = new Map<string, string>();
	for (const line of head.replaceAll(UNFOLD, ' ').split(/\r?\n/u)) {
		const colon = line.indexOf(':');
		if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
	}
	return headers;
}

function addresses(value: string): string[] {
	return value
		.split(',')
		.map((part) => (ANGLE_ADDRESS.exec(part)?.groups?.address ?? part).trim())
		.filter((part) => part !== '');
}

function envelopeOf(mime: string): Envelope {
	const headers = unfoldedHeaders(mime);
	return {
		from: addresses(headers.get('from') ?? '')[0] ?? '',
		to: [...addresses(headers.get('to') ?? ''), ...addresses(headers.get('bcc') ?? '')],
	};
}

function simpleMime(parts: {
	from: string;
	to: readonly string[];
	bcc?: readonly string[];
	replyTo?: string;
	subject: string;
	messageId?: string;
	html: string;
	text?: string;
}): string {
	const boundary = `fake-${randomUUID()}`;
	const subject = NON_ASCII.test(parts.subject)
		? `=?UTF-8?B?${Buffer.from(parts.subject, 'utf8').toString('base64')}?=`
		: parts.subject;
	const lines = [
		`From: ${parts.from}`,
		`To: ${parts.to.join(', ')}`,
		...(parts.bcc !== undefined && parts.bcc.length > 0 ? [`Bcc: ${parts.bcc.join(', ')}`] : []),
		...(parts.replyTo === undefined ? [] : [`Reply-To: ${parts.replyTo}`]),
		`Subject: ${subject}`,
		`Date: ${new Date().toUTCString()}`,
		...(parts.messageId === undefined ? [] : [`Message-ID: ${parts.messageId}`]),
		'MIME-Version: 1.0',
		`Content-Type: multipart/alternative; boundary="${boundary}"`,
		'',
		`--${boundary}`,
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: base64',
		'',
		Buffer.from(parts.text ?? '', 'utf8').toString('base64'),
		`--${boundary}`,
		'Content-Type: text/html; charset=UTF-8',
		'Content-Transfer-Encoding: base64',
		'',
		Buffer.from(parts.html, 'utf8').toString('base64'),
		`--${boundary}--`,
		'',
	];
	return lines.join('\r\n');
}

function graphRecipients(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => asText(record(record(entry).emailAddress).address))
		.filter((address) => address !== '');
}

function graphJsonMime(mailbox: string, payload: Json): string {
	const message = record(payload.message);
	const body = record(message.body);
	const replyTo = graphRecipients(message.replyTo)[0];
	return simpleMime({
		bcc: graphRecipients(message.bccRecipients),
		from: mailbox,
		html: asText(body.content),
		...(replyTo === undefined ? {} : { replyTo }),
		subject: asText(message.subject),
		to: graphRecipients(message.toRecipients),
	});
}

function resendMime(payload: Json): string {
	const toList = (value: unknown): string[] =>
		(Array.isArray(value) ? value : [value])
			.map((entry) => asText(entry))
			.filter((entry) => entry !== '');
	const headers = record(payload.headers);
	const replyTo = asText(payload.reply_to);
	return simpleMime({
		bcc: toList(payload.bcc),
		from: asText(payload.from),
		html: asText(payload.html),
		messageId: asText(headers['Message-ID']),
		...(replyTo === '' ? {} : { replyTo }),
		subject: asText(payload.subject),
		text: asText(payload.text),
		to: toList(payload.to),
	});
}

function mailboxOf(raw: string): string {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

function ndrBody(hard: boolean, originalMessageId: string): string {
	const status = hard ? '5.1.1' : '4.4.7';
	return [
		'Your message could not be delivered.',
		`Diagnostic information: 550 ${status} Delivery has failed.`,
		`Status: ${status}`,
		`Original message: ${originalMessageId}`,
	].join('\n');
}

/**
 * Sends a signed Svix webhook to the app.
 *
 * @param input `appUrl`, `connectionId`, `secret` (`whsec_…`), `emailId`, `type` and `hard`.
 * @returns The HTTP status the app answered.
 */
async function sendWebhook(input: Json): Promise<number> {
	const hard = input.hard === true;
	const kind = asText(input.type);
	const event =
		kind === 'complaint'
			? { data: { email_id: asText(input.emailId) }, type: 'email.complained' }
			: {
					data: {
						bounce: { type: hard ? 'Permanent' : 'Transient' },
						email_id: asText(input.emailId),
					},
					type: kind === 'other' ? 'email.delivered' : 'email.bounced',
				};
	const body = JSON.stringify({ ...event, created_at: new Date().toISOString() });
	const id = `msg_${randomUUID()}`;
	const timestamp = String(Math.floor(Date.now() / MS_PER_SECOND));
	const secret = asText(input.secret);
	const key = Buffer.from(secret.replace(SECRET_PREFIX, ''), 'base64');
	const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
	const target = `${asText(input.appUrl).replace(TRAILING_SLASHES, '')}/api/webhooks/resend/${encodeURIComponent(asText(input.connectionId))}`;
	const answer = await fetch(target, {
		body,
		headers: {
			'content-type': 'application/json',
			'svix-id': id,
			'svix-signature': `v1,${signature}`,
			'svix-timestamp': timestamp,
		},
		method: 'POST',
	});
	await answer.body?.cancel();
	return answer.status;
}

/**
 * Starts the fake Graph and Resend server.
 *
 * @param options The port (0 picks a free one) and where accepted mail goes.
 * @returns The base address and a function that stops the server.
 */
async function startFakeProviders(
	options: Readonly<FakeProvidersOptions>,
): Promise<{ url: string; close: () => Promise<void> }> {
	let requests: RecordedRequest[] = [];
	let senders = new Set<string>();
	let ndrs: { mailbox: string; message: NdrMessage }[] = [];
	let idempotent = new Map<string, string>();

	async function deliverMime(mime: string, response: ServerResponse): Promise<boolean> {
		try {
			await options.deliver(mime, envelopeOf(mime));
			return true;
		} catch {
			send(response, HTTP_UNAVAILABLE, { error: { code: 'fake.deliveryFailed' } });
			return false;
		}
	}

	function mailboxReadable(mailbox: string): boolean {
		return senders.has(mailbox) || mailbox === READABLE_MAILBOX;
	}

	function inbox(mailbox: string, query: URLSearchParams): { value: NdrMessage[] } {
		const since = SINCE.exec(query.get('$filter') ?? '')?.groups?.since;
		const sinceTime = since === undefined ? 0 : new Date(since).getTime();
		const top = Number(query.get('$top') ?? DEFAULT_TOP);
		const value = ndrs
			.filter((entry) => entry.mailbox === mailbox)
			.map((entry) => entry.message)
			.filter((message) => new Date(message.receivedDateTime).getTime() >= sinceTime)
			.toSorted((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime))
			.slice(0, Number.isFinite(top) ? top : DEFAULT_TOP);
		return { value };
	}

	async function graphSendMail(
		request: IncomingMessage,
		response: ServerResponse,
		target: Readonly<{ mailbox: string; path: string }>,
	): Promise<void> {
		const { mailbox, path } = target;
		const raw = await readBody(request);
		const isJson = (request.headers['content-type'] ?? '').includes('application/json');
		if (isJson) {
			const payload = parseJson(raw);
			requests.push({
				method: 'POST',
				path,
				savedToSentItems: payload.saveToSentItems !== false,
			});
			if (await deliverMime(graphJsonMime(mailbox, payload), response)) {
				send(response, HTTP_ACCEPTED);
			}
			return;
		}
		requests.push({ method: 'POST', path });
		const mime = Buffer.from(raw.trim(), 'base64').toString('utf8');
		if (await deliverMime(mime, response)) send(response, HTTP_ACCEPTED);
	}

	async function graph(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
	): Promise<boolean> {
		if (request.method === 'POST' && TOKEN_ROUTE.test(url.pathname)) {
			requests.push({ method: 'POST', path: url.pathname });
			const form = new URLSearchParams(await readBody(request));
			if (form.get('client_secret') === WRONG_SECRET) {
				send(response, HTTP_UNAUTHORIZED, { error: 'invalid_client' });
			} else {
				send(response, HTTP_OK, {
					access_token: `fake-token-${randomUUID()}`,
					expires_in: 3600,
					token_type: 'Bearer',
				});
			}
			return true;
		}
		const route = GRAPH_ROUTE.exec(url.pathname)?.groups;
		if (route === undefined) return false;
		const mailbox = mailboxOf(route.mailbox ?? '');
		const rest = route.rest ?? '';
		if (bearer(request) === WRONG_SECRET || bearer(request) === '') {
			requests.push({ method: request.method ?? '', path: url.pathname });
			send(response, HTTP_UNAUTHORIZED, { error: { code: 'InvalidAuthenticationToken' } });
			return true;
		}
		if (request.method === 'POST' && rest === 'sendMail') {
			await graphSendMail(request, response, { mailbox, path: url.pathname });
			return true;
		}
		if (request.method !== 'GET') return false;
		const inboxRead = rest === 'mailFolders/inbox/messages';
		if (!inboxRead && rest !== 'messages') return false;
		requests.push({ method: 'GET', path: url.pathname });
		if (mailboxReadable(mailbox)) {
			send(response, HTTP_OK, inboxRead ? inbox(mailbox, url.searchParams) : { value: [] });
		} else {
			send(response, HTTP_FORBIDDEN, { error: { code: 'ErrorAccessDenied' } });
		}
		return true;
	}

	async function resend(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
	): Promise<boolean> {
		if (request.method !== 'POST' || url.pathname !== '/resend/emails') return false;
		requests.push({ method: 'POST', path: url.pathname });
		const raw = await readBody(request);
		if (bearer(request) === WRONG_SECRET || bearer(request) === '') {
			send(response, HTTP_UNAUTHORIZED, {
				message: 'API key is invalid',
				name: 'restricted_api_key',
				statusCode: HTTP_UNAUTHORIZED,
			});
			return true;
		}
		const key = request.headers['idempotency-key'];
		const known = typeof key === 'string' ? idempotent.get(key) : undefined;
		if (known !== undefined) {
			send(response, HTTP_OK, { id: known });
			return true;
		}
		const id = randomUUID();
		// Stored before the delivery, so a concurrent duplicate finds it.
		if (typeof key === 'string') idempotent.set(key, id);
		if (!(await deliverMime(resendMime(parseJson(raw)), response))) {
			if (typeof key === 'string') idempotent.delete(key);
			return true;
		}
		send(response, HTTP_OK, { id });
		return true;
	}

	function addNdr(input: Json): void {
		const mailbox = asText(input.mailbox);
		const original = asText(input.originalMessageId);
		const content = ndrBody(input.hard === true, original);
		// Whole seconds, like Graph: the bounce cursor compares them.
		const received = new Date(Math.floor(Date.now() / MS_PER_SECOND) * MS_PER_SECOND);
		ndrs.push({
			mailbox,
			message: {
				body: { content },
				bodyPreview: content.slice(0, SNIPPET_LENGTH),
				id: `ndr-${randomUUID()}`,
				internetMessageHeaders: [{ name: 'In-Reply-To', value: original }],
				receivedDateTime: received.toISOString(),
			},
		});
	}

	async function control(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
	): Promise<boolean> {
		const path = url.pathname.slice('/__control'.length);
		if (request.method === 'GET' && path === '/requests') {
			send(response, HTTP_OK, requests);
			return true;
		}
		if (request.method !== 'POST') return false;
		const input = parseJson(await readBody(request));
		switch (path) {
			case '/reset': {
				requests = [];
				senders = new Set();
				ndrs = [];
				idempotent = new Map();
				send(response, HTTP_OK, {});
				return true;
			}
			case '/senders': {
				const list = Array.isArray(input.mailboxes)
					? input.mailboxes.map((entry) => asText(entry))
					: [];
				senders = new Set(list);
				send(response, HTTP_OK, {});
				return true;
			}
			case '/graph/ndr': {
				addNdr(input);
				send(response, HTTP_OK, {});
				return true;
			}
			case '/resend/webhook': {
				try {
					send(response, HTTP_OK, { status: await sendWebhook(input) });
				} catch {
					send(response, HTTP_BAD_REQUEST, { error: 'fake.webhookFailed' });
				}
				return true;
			}
			default: {
				return false;
			}
		}
	}

	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? '/', 'http://localhost');
		try {
			const handled = url.pathname.startsWith('/__control/')
				? await control(request, response, url)
				: (await graph(request, response, url)) || (await resend(request, response, url));
			if (!handled) send(response, HTTP_NOT_FOUND, { error: 'fake.notFound' });
		} catch (error) {
			const status = error instanceof BodyTooLargeError ? HTTP_TOO_LARGE : HTTP_UNAVAILABLE;
			if (!response.headersSent) send(response, status, { error: 'fake.failed' });
		}
	}

	const server = createServer((request, response) => {
		// oxlint-disable-next-line no-void -- `handle` catches everything; a listener must return nothing
		void handle(request, response);
	});
	server.listen(options.port, LOOPBACK);
	await once(server, 'listening');
	const address = server.address();
	const port = typeof address === 'object' && address !== null ? address.port : options.port;
	return {
		close: async () => {
			const closed = Promise.withResolvers<null>();
			server.close(() => {
				closed.resolve(null);
			});
			server.closeAllConnections();
			await closed.promise;
		},
		url: `http://localhost:${port}`,
	};
}

if (import.meta.main) {
	const transport = createTransport({ host: SMTP_HOST, port: SMTP_PORT });
	// oxlint-disable-next-line node/no-top-level-await -- the entry point of `node e2e/fakes/providers.ts`
	const { url } = await startFakeProviders({
		deliver: async (mime, envelope) => {
			await transport.sendMail({ envelope, raw: mime });
		},
		port: 3200,
	});
	// oxlint-disable-next-line no-console -- the one line a developer needs: where the fake listens
	console.info(`Fake providers listening on ${url}`);
}

export { startFakeProviders };
export type { FakeProvidersOptions };
