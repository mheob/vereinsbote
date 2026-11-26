import { once } from 'node:events';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';

import {
	checkMailboxRestriction,
	createGraphTransport,
	graphEndpoints,
} from '@/server/sending/graph';
import type { GraphDeps, GraphSettings } from '@/server/sending/graph';
import { createResendTransport, resendEndpoint } from '@/server/sending/resend';
import { verifyResendWebhook } from '@/server/sending/resend-webhook';
import type { OutgoingMail } from '@/server/sending/transport';

import { startFakeProviders } from './providers';

interface Delivered {
	readonly mime: string;
	readonly envelope: Readonly<{ from: string; to: string[] }>;
}

interface Received {
	readonly headers: Headers;
	readonly body: string;
}

const MAILBOX = 'verein@example.org';
const MEMBER = 'member@example.org';
const MESSAGE_ID = '<abc123@example.org>';
const SETTINGS: GraphSettings = {
	clientId: 'client-id-1',
	clientSecret: 'any-secret',
	tenantId: 'tenant-1',
};
const WEBHOOK_SECRET = `whsec_${btoa('fake-webhook-secret-bytes')}`;
const HTTP_FORBIDDEN = 403;
const HTTP_OK = 200;
const HTTP_TOO_LARGE = 413;
const HTTP_NO_CONTENT = 204;
const FUTURE_MS = 10_000;
const LIMIT = 50;

const requestList = z.array(
	z.object({ path: z.string(), savedToSentItems: z.boolean().optional() }),
);
const addressList = z.array(z.string());
const resendList = z.array(z.object({ id: z.string(), to: addressList }));

const closers: (() => Promise<unknown>)[] = [];

function mail(overrides: Partial<OutgoingMail> = {}): OutgoingMail {
	return {
		attachments: [],
		bcc: null,
		from: { address: MAILBOX, name: 'Verein' },
		html: '<p>Hello</p>',
		idempotencyKey: 'key-1',
		kind: 'regular',
		listUnsubscribe: null,
		messageId: MESSAGE_ID,
		replyTo: null,
		subject: 'Greetings',
		text: 'Hello',
		to: MEMBER,
		...overrides,
	};
}

async function start(): Promise<{ url: string; delivered: Delivered[] }> {
	const delivered: Delivered[] = [];
	const server = await startFakeProviders({
		deliver: async (mime, envelope) => {
			delivered.push({ envelope, mime });
			await Promise.resolve();
		},
		port: 0,
	});
	closers.push(server.close);
	return { delivered, url: server.url };
}

function graphDeps(url: string): GraphDeps {
	return {
		endpoints: graphEndpoints({ devProvidersUrl: new URL(url) }),
		fetch,
		now: () => new Date(),
	};
}

function resendTransport(
	url: string,
	key = 're_any_key',
): ReturnType<typeof createResendTransport> {
	return createResendTransport(key, {
		endpoint: resendEndpoint({ devProvidersUrl: new URL(url) }),
		fetch,
		now: () => new Date(),
	});
}

async function control(url: string, path: string, body: unknown): Promise<Response> {
	return fetch(`${url}/__control${path}`, {
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	});
}

async function recorded(url: string): Promise<z.infer<typeof requestList>> {
	const response = await fetch(`${url}/__control/requests`);
	return requestList.parse(await response.json());
}

async function resendMails(url: string): Promise<z.infer<typeof resendList>> {
	const response = await fetch(`${url}/__control/resend/emails`);
	return resendList.parse(await response.json());
}

// A stand-in for the app that keeps what it is sent and answers 204.
async function startReceiver(): Promise<{ url: string; received: Received[] }> {
	const received: Received[] = [];
	const server = createServer((request, response) => {
		request.setEncoding('utf8');
		let body = '';
		request.on('data', (chunk) => {
			body += String(chunk);
		});
		request.on('end', () => {
			const pairs = Object.entries(request.headers).flatMap(([name, value]) =>
				typeof value === 'string' ? [[name, value] as [string, string]] : [],
			);
			received.push({ body, headers: new Headers(pairs) });
			response.writeHead(HTTP_NO_CONTENT).end();
		});
	});
	server.listen(0);
	await once(server, 'listening');
	const address = server.address();
	const port = typeof address === 'object' ? address?.port : 0;
	closers.push(async () => {
		const closed = Promise.withResolvers<null>();
		server.close(() => {
			closed.resolve(null);
		});
		server.closeAllConnections();
		await closed.promise;
	});
	return { received, url: `http://localhost:${port}` };
}

describe('fake providers', () => {
	afterEach(async () => {
		await Promise.all(closers.splice(0).map(async (close) => close()));
	});

	it('delivers a mime mail sent through the real graph transport', async () => {
		const { delivered, url } = await start();
		const transport = createGraphTransport(SETTINGS, MAILBOX, graphDeps(url));
		await expect(transport.send(mail())).resolves.toStrictEqual({ ok: true, providerId: null });
		expect(delivered).toHaveLength(1);
		expect(delivered.map((entry) => entry.mime).join('')).toContain('Subject: Greetings');
		expect(delivered.map((entry) => entry.envelope)).toStrictEqual([
			{ from: MAILBOX, to: [MEMBER] },
		]);
	});

	it('delivers a system mail sent as json and notes that it was not stored', async () => {
		const { delivered, url } = await start();
		const transport = createGraphTransport(SETTINGS, MAILBOX, graphDeps(url));
		const sent = await transport.send(mail({ kind: 'system' }));
		expect(sent.ok).toBe(true);
		expect(delivered.map((entry) => entry.mime).join('')).toContain('Subject: Greetings');
		expect(delivered.map((entry) => entry.envelope.to)).toStrictEqual([[MEMBER]]);
		const requests = await recorded(url);
		const sendMail = requests.filter((entry) => entry.path.endsWith('/sendMail'));
		expect(sendMail.map((entry) => entry.savedToSentItems)).toStrictEqual([false]);
	});

	it('refuses wrong-secret with 401', async () => {
		const { url } = await start();
		const graph = createGraphTransport(
			{ ...SETTINGS, clientSecret: 'wrong-secret' },
			MAILBOX,
			graphDeps(url),
		);
		await expect(graph.send(mail())).resolves.toMatchObject({
			code: 'graph.unauthorized',
			ok: false,
		});
		await expect(resendTransport(url, 'wrong-secret').send(mail())).resolves.toMatchObject({
			failure: 'unauthorized',
			ok: false,
		});
	});

	it('lists an injected bounce report that parseNdr reads', async () => {
		const { url } = await start();
		await control(url, '/senders', { mailboxes: [MAILBOX] });
		await control(url, '/graph/ndr', {
			hard: true,
			mailbox: MAILBOX,
			originalMessageId: MESSAGE_ID,
		});
		await control(url, '/graph/ndr', {
			hard: false,
			mailbox: MAILBOX,
			originalMessageId: '<soft@example.org>',
		});
		const transport = createGraphTransport(SETTINGS, MAILBOX, graphDeps(url));
		const result = await transport.fetchBounces?.(null, LIMIT);
		expect(
			result?.reports.map(({ hard, originalMessageId }) => ({ hard, originalMessageId })),
		).toStrictEqual([
			{ hard: true, originalMessageId: MESSAGE_ID },
			{ hard: false, originalMessageId: '<soft@example.org>' },
		]);
		expect(result?.until).toBeInstanceOf(Date);
		const later = await transport.fetchBounces?.(new Date(Date.now() + FUTURE_MS), LIMIT);
		expect(later?.reports).toStrictEqual([]);
	});

	it('answers 403 for mailboxes that are not senders', async () => {
		const { url } = await start();
		const deps = graphDeps(url);
		await expect(checkMailboxRestriction(SETTINGS, 'other@example.org', deps)).resolves.toBe(
			'restricted',
		);
		await expect(checkMailboxRestriction(SETTINGS, 'readable@verein.test', deps)).resolves.toBe(
			'readable',
		);
		const transport = createGraphTransport(SETTINGS, 'other@example.org', deps);
		await expect(transport.fetchBounces?.(null, LIMIT)).rejects.toThrow('graph.mailbox');
		const direct = await fetch(`${url}/graph/v1.0/users/other%40example.org/messages?$top=1`, {
			headers: { authorization: 'Bearer fake-token' },
		});
		expect(direct.status).toBe(HTTP_FORBIDDEN);
	});

	it('drops a second resend mail with the same idempotency key', async () => {
		const { delivered, url } = await start();
		const transport = resendTransport(url);
		const first = await transport.send(mail());
		const second = await transport.send(mail());
		expect(first.ok).toBe(true);
		expect(second).toStrictEqual(first);
		expect(delivered).toHaveLength(1);
		expect(delivered.map((entry) => entry.mime).join('')).toContain(`Message-ID: ${MESSAGE_ID}`);
		await transport.send(mail({ idempotencyKey: 'key-2' }));
		expect(delivered).toHaveLength(2);
	});

	it('lists each resend mail it accepted once, with the id it answered', async () => {
		const { url } = await start();
		const transport = resendTransport(url);
		const first = await transport.send(mail());
		await transport.send(mail());
		const second = await transport.send(mail({ idempotencyKey: 'key-2', to: MAILBOX }));
		const listed = await resendMails(url);
		expect(listed.map(({ to }) => to)).toStrictEqual([[MEMBER], [MAILBOX]]);
		expect([first, second]).toStrictEqual(listed.map(({ id }) => ({ ok: true, providerId: id })));
		await control(url, '/reset', {});
		await expect(resendMails(url)).resolves.toStrictEqual([]);
	});

	it('signs a webhook that verifyResendWebhook accepts', async () => {
		const { url } = await start();
		const app = await startReceiver();
		const response = await control(url, '/resend/webhook', {
			appUrl: app.url,
			connectionId: 'conn-1',
			emailId: 'email-1',
			hard: true,
			secret: WEBHOOK_SECRET,
			type: 'bounce',
		});
		expect(response.status).toBe(HTTP_OK);
		await expect(response.json()).resolves.toStrictEqual({ status: HTTP_NO_CONTENT });
		expect(app.received).toHaveLength(1);
		const events = await Promise.all(
			app.received.map(async ({ body, headers }) =>
				verifyResendWebhook(WEBHOOK_SECRET, headers, body, new Date()),
			),
		);
		expect(events).toMatchObject([{ emailId: 'email-1', hard: true, type: 'bounce' }]);
	});

	it('takes a graph mail up to the request limit of graph', async () => {
		const { delivered, url } = await start();
		const transport = createGraphTransport(SETTINGS, MAILBOX, graphDeps(url));
		// About 3.7 MB as a request: the attachment is base64 in the MIME, the MIME base64 again.
		const bytes = new Uint8Array(2_000_000).fill(65);
		const result = await transport.send(
			mail({ attachments: [{ bytes, contentType: 'application/pdf', filename: 'flyer.pdf' }] }),
		);
		expect(result).toStrictEqual({ ok: true, providerId: null });
		expect(delivered).toHaveLength(1);
	});

	it('answers 413 for a body above 5 MiB', async () => {
		const { url } = await start();
		const response = await control(url, '/senders', { mailboxes: ['x'.repeat(5_300_000)] });
		expect(response.status).toBe(HTTP_TOO_LARGE);
	});

	it('records the sendMail path the same way for mime and json', async () => {
		const { url } = await start();
		const transport = createGraphTransport(SETTINGS, MAILBOX, graphDeps(url));
		await transport.send(mail());
		await transport.send(mail({ kind: 'system' }));
		const all = await recorded(url);
		const paths = all.filter((entry) => entry.path.endsWith('/sendMail'));
		expect(new Set(paths.map((entry) => entry.path)).size).toBe(1);
	});

	it('delivers once when two resend calls with one key run at the same time', async () => {
		const { delivered, url } = await start();
		const transport = resendTransport(url);
		await Promise.all([transport.send(mail()), transport.send(mail())]);
		expect(delivered).toHaveLength(1);
	});

	it('forgets everything on reset', async () => {
		const { url } = await start();
		await control(url, '/senders', { mailboxes: [MAILBOX] });
		await fetch(`${url}/graph/v1.0/users/x/messages`);
		await control(url, '/reset', {});
		await expect(recorded(url)).resolves.toStrictEqual([]);
		await expect(checkMailboxRestriction(SETTINGS, MAILBOX, graphDeps(url))).resolves.toBe(
			'restricted',
		);
	});
});
