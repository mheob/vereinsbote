import { describe, expect, it } from 'vite-plus/test';

import { budgetedFetch, createSubrequestBudget } from '@/platform/subrequests';
import {
	checkMailboxRestriction,
	classifyGraphResponse,
	createGraphTransport,
	graphEndpoints,
	inboxBouncesUrl,
	mailboxUrl,
	parseNdr,
} from '@/server/sending/graph';
import type { GraphDeps, GraphSettings } from '@/server/sending/graph';
import type { OutgoingMail, SendResult } from '@/server/sending/transport';

const NOW = new Date('2026-11-25T10:00:00Z');
const SECRET = 'client-secret-value-123';
const TOKEN = 'access-token-value-456';
const MAILBOX = 'verein@example.org';
const PROBE = 'probe@example.org';
const SETTINGS: GraphSettings = {
	clientId: 'client-id-1',
	clientSecret: SECRET,
	tenantId: 'tenant-1',
};
const ENDPOINTS = { graph: 'https://graph.test/v1.0', login: 'https://login.test' };
const MAILBOX_URL = mailboxUrl(ENDPOINTS, MAILBOX);
const NONE = new Headers();
const HTTP_ACCEPTED = 202;

interface Recorded {
	readonly url: string;
	readonly method: string;
	readonly headers: Headers;
	readonly body: string;
	readonly hasSignal: boolean;
}

type Responder = (request: Recorded) => Response;

function json(status: number, body: unknown, retryAfter: string | null = null): Response {
	const headers = new Headers();
	if (retryAfter !== null) headers.set('retry-after', retryAfter);
	return Response.json(body, { headers, status });
}

function tokenOk(): Response {
	return json(200, { access_token: TOKEN, expires_in: 3600, token_type: 'Bearer' });
}

function accepted(): Response {
	return new Response(null, { status: HTTP_ACCEPTED });
}

function urlOf(input: string | URL | Request): string {
	if (typeof input === 'string') return input;
	return input instanceof URL ? input.href : input.url;
}

function bodyOf(body: unknown): string {
	return typeof body === 'string' ? body : '';
}

function setup(
	responder: Responder,
	loginResponder: Responder = tokenOk,
): { deps: GraphDeps; requests: Recorded[] } {
	const requests: Recorded[] = [];
	const fakeFetch: GraphDeps['fetch'] = async (input, init) => {
		const recorded: Recorded = {
			body: bodyOf(init?.body),
			hasSignal: init?.signal instanceof AbortSignal,
			headers: new Headers(init?.headers),
			method: init?.method ?? 'GET',
			url: urlOf(input),
		};
		requests.push(recorded);
		const isLogin = recorded.url.startsWith(`${ENDPOINTS.login}/`);
		const response = await Promise.resolve((isLogin ? loginResponder : responder)(recorded));
		return response;
	};
	return { deps: { endpoints: ENDPOINTS, fetch: fakeFetch, now: () => NOW }, requests };
}

const DOWN: GraphDeps = {
	endpoints: ENDPOINTS,
	fetch: async () => {
		await Promise.resolve();
		throw new TypeError(`fetch failed ${SECRET}`);
	},
	now: () => NOW,
};

function requestTo(requests: readonly Recorded[], part: string): Recorded {
	const found = requests.find((request) => request.url.includes(part));
	if (found === undefined) throw new Error(`no request to ${part}`);
	return found;
}

function decodeBase64(text: string): string {
	return new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.codePointAt(0) ?? 0));
}

function mail(overrides: Partial<OutgoingMail> = {}): OutgoingMail {
	return {
		attachments: [],
		bcc: null,
		from: { address: MAILBOX, name: 'Förderverein Süd' },
		html: '<p>Hallo Anna</p>',
		idempotencyKey: null,
		kind: 'regular',
		listUnsubscribe: 'https://app.example.org/unsubscribe/abc',
		messageId: '<abc123@example.org>',
		replyTo: null,
		subject: 'Einladung',
		text: 'Hallo Anna',
		to: 'anna@example.org',
		...overrides,
	};
}

function codeOf(result: Readonly<SendResult>): string | null {
	return result.ok ? null : result.code;
}

describe(graphEndpoints, () => {
	it('uses Microsoft by default', () => {
		expect(graphEndpoints({ devProvidersUrl: null })).toStrictEqual({
			graph: 'https://graph.microsoft.com/v1.0',
			login: 'https://login.microsoftonline.com',
		});
	});

	it('uses the dev providers server when set', () => {
		expect(graphEndpoints({ devProvidersUrl: new URL('http://localhost:4010/') })).toStrictEqual({
			graph: 'http://localhost:4010/graph/v1.0',
			login: 'http://localhost:4010/login',
		});
	});

	it('trims a long run of trailing slashes quickly', () => {
		const started = performance.now();
		const url = new URL(`http://localhost:4010/${'/'.repeat(200_000)}x${'/'.repeat(200_000)}`);
		expect(graphEndpoints({ devProvidersUrl: url }).graph).toBe(
			`http://localhost:4010/${'/'.repeat(200_000)}x/graph/v1.0`,
		);
		expect(performance.now() - started).toBeLessThan(1000);
	});
});

describe('graph transport send', () => {
	it('gets one token for two mails', async () => {
		const { deps, requests } = setup(accepted);
		const transport = createGraphTransport(SETTINGS, MAILBOX, deps);

		const first = await transport.send(mail());
		const second = await transport.send(mail({ to: 'berta@example.org' }));

		expect([first, second]).toStrictEqual([
			{ ok: true, providerId: null },
			{ ok: true, providerId: null },
		]);
		expect(requests.filter((request) => request.url.includes('/oauth2/'))).toHaveLength(1);
		expect(requests.filter((request) => request.url.endsWith('/sendMail'))).toHaveLength(2);
	});

	it('asks for a token with client credentials', async () => {
		const { deps, requests } = setup(accepted);

		await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

		const request = requestTo(requests, '/oauth2/');
		expect(request.url).toBe('https://login.test/tenant-1/oauth2/v2.0/token');
		expect(Object.fromEntries(new URLSearchParams(request.body))).toStrictEqual({
			client_id: 'client-id-1',
			client_secret: SECRET,
			grant_type: 'client_credentials',
			scope: 'https://graph.microsoft.com/.default',
		});
	});

	it('sends the mime as base64 text', async () => {
		const { deps, requests } = setup(accepted);

		await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

		const request = requestTo(requests, '/sendMail');
		expect(request.url).toBe(`${MAILBOX_URL}/sendMail`);
		expect(request.headers.get('content-type')).toBe('text/plain');
		expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
		expect(decodeBase64(request.body)).toContain('Message-ID: <abc123@example.org>');
		expect(decodeBase64(request.body)).toContain('List-Unsubscribe');
	});

	it('sends system mail as json without saving it', async () => {
		const { deps, requests } = setup(accepted);
		const attachment = {
			bytes: new Uint8Array([1, 2, 3]),
			contentType: 'application/pdf',
			filename: 'a.pdf',
		} as const;

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(
			mail({ attachments: [attachment], kind: 'system', replyTo: 'antwort@example.org' }),
		);

		const request = requestTo(requests, '/sendMail');
		expect(result).toStrictEqual({ ok: true, providerId: null });
		expect(request.headers.get('content-type')).toBe('application/json');
		expect(JSON.parse(request.body)).toMatchObject({
			message: {
				body: { content: '<p>Hallo Anna</p>', contentType: 'HTML' },
				replyTo: [{ emailAddress: { address: 'antwort@example.org' } }],
				subject: 'Einladung',
				toRecipients: [{ emailAddress: { address: 'anna@example.org' } }],
			},
			saveToSentItems: false,
		});
		expect(request.body).not.toContain('attachments');
		expect(request.body).not.toContain('nsubscribe');
	});

	it('refuses a mail over the graph request limit without calling graph', async () => {
		const { deps, requests } = setup(accepted);

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(
			mail({ html: 'x'.repeat(3_100_000) }),
		);

		expect(result).toStrictEqual({
			code: 'graph.tooLarge',
			failure: 'rejected',
			ok: false,
			retryAfterMs: null,
		});
		expect(requests).toHaveLength(0);
	});

	it('rejects an invalid address without calling graph', async () => {
		const { deps, requests } = setup(accepted);

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(
			mail({ to: 'a b@example.org' }),
		);

		expect(result).toStrictEqual({
			code: 'mime.address',
			failure: 'rejected',
			ok: false,
			retryAfterMs: null,
		});
		expect(requests).toHaveLength(0);
	});

	it('maps a refused token request to unauthorized and stops', async () => {
		const { deps, requests } = setup(accepted, () =>
			json(401, { error: 'invalid_client', error_description: SECRET }),
		);

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

		expect(result).toMatchObject({ code: 'graph.unauthorized', failure: 'unauthorized' });
		expect(requests).toHaveLength(1);
	});

	it('treats a token server error as transient', async () => {
		const { deps } = setup(accepted, () => json(503, {}, '9'));

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

		expect(result).toMatchObject({ failure: 'transient', retryAfterMs: 9000 });
	});

	it('treats a network error of the token request as transient', async () => {
		const result = await createGraphTransport(SETTINGS, MAILBOX, DOWN).send(mail());

		expect(result).toStrictEqual({
			code: 'graph.network',
			failure: 'transient',
			ok: false,
			retryAfterMs: null,
		});
	});

	it('marks a network error or time-out of sendMail as uncertain', async () => {
		const { deps } = setup(() => {
			throw new TypeError(`fetch failed ${SECRET}`);
		});

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

		expect(result).toStrictEqual({
			code: 'graph.network',
			failure: 'uncertain',
			ok: false,
			retryAfterMs: null,
		});
	});

	it('maps a sendMail the platform refused to make to transient, never uncertain', async () => {
		const { deps } = setup(() => {
			throw new Error('Too many subrequests.');
		});

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

		expect(result).toStrictEqual({
			code: 'platform.subrequests',
			failure: 'transient',
			ok: false,
			retryAfterMs: null,
		});
	});

	it('maps a token request the budget refused to transient', async () => {
		const { deps, requests } = setup(accepted);
		const limited = {
			...deps,
			fetch: budgetedFetch(deps.fetch, createSubrequestBudget(0)),
		};

		const result = await createGraphTransport(SETTINGS, MAILBOX, limited).send(mail());

		expect(result).toMatchObject({ code: 'platform.subrequests', failure: 'transient' });
		expect(requests).toHaveLength(0);
	});

	it.each([500, 502, 504])(
		'marks %i of sendMail as uncertain without a retry time',
		async (status) => {
			const { deps } = setup(() => json(status, {}, '5'));

			const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

			expect(result).toStrictEqual({
				code: 'graph.server',
				failure: 'uncertain',
				ok: false,
				retryAfterMs: null,
			});
		},
	);

	it.each([408, 429, 503])('keeps %i of sendMail transient', async (status) => {
		const { deps } = setup(() => json(status, {}));

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

		expect(result).toMatchObject({ failure: 'transient', ok: false });
	});

	it('reuses a token without expires_in for a default lifetime', async () => {
		const { deps, requests } = setup(accepted, () => json(200, { access_token: TOKEN }));
		const transport = createGraphTransport(SETTINGS, MAILBOX, deps);

		await transport.send(mail());
		await transport.send(mail());

		expect(requests.filter((request) => request.url.includes('/oauth2/'))).toHaveLength(1);
	});

	it('shares one token request between concurrent sends', async () => {
		const { deps, requests } = setup(accepted);
		const transport = createGraphTransport(SETTINGS, MAILBOX, deps);

		await Promise.all([transport.send(mail()), transport.send(mail())]);

		expect(requests.filter((request) => request.url.includes('/oauth2/'))).toHaveLength(1);
	});

	it('passes a time-out signal to every call', async () => {
		const { deps, requests } = setup(accepted);

		await createGraphTransport(SETTINGS, MAILBOX, deps).send(mail());

		expect(requests).toHaveLength(2);
		expect(requests.every((request) => request.hasSignal)).toBe(true);
	});

	it.each(
		[400, 401, 403, 404, 413, 429, 500, 503].flatMap((status) => [
			{ body: { error: { code: 'ErrorInvalidRecipients', message: 'anna@example.org' } }, status },
			{ body: { error: { code: 'x', message: `${SECRET} ${TOKEN}` } }, status },
		]),
	)(
		'never puts the secret, the token or an address into a failure ($status)',
		async ({ body, status }) => {
			const { deps } = setup(() => json(status, body));
			const transport = createGraphTransport(SETTINGS, MAILBOX, deps);

			const text = JSON.stringify(await transport.send(mail()));

			expect(text).not.toContain(SECRET);
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain('example.org');
		},
	);
});

describe(classifyGraphResponse, () => {
	it.each([
		[401, 'unauthorized'],
		[403, 'unauthorized'],
		[429, 'transient'],
		[503, 'transient'],
		[408, 'transient'],
		[502, 'uncertain'],
		[400, 'rejected'],
	] as const)('classifies %i', (status, failure) => {
		expect(classifyGraphResponse(status, {}, NONE, NOW)).toMatchObject({ failure, ok: false });
	});

	it.each([
		[401, {}, 'graph.unauthorized'],
		// The token came, so the app may not use the mailbox (RBAC for Applications).
		[403, { error: { code: 'ErrorAccessDenied' } }, 'graph.mailbox'],
		[429, {}, 'graph.throttled'],
		[500, {}, 'graph.server'],
		[408, {}, 'graph.network'],
		[404, {}, 'graph.mailbox'],
		[413, {}, 'graph.tooLarge'],
		[400, { error: { code: 'ErrorInvalidRecipients' } }, 'graph.recipient'],
		[400, { error: { code: 'ErrorInvalidMailboxItemId' } }, 'graph.rejected'],
		[400, null, 'graph.rejected'],
	] as const)('names the code of %i', (status, body, code) => {
		expect(codeOf(classifyGraphResponse(status, body, NONE, NOW))).toBe(code);
	});

	it('accepts 2xx', () => {
		expect(classifyGraphResponse(202, null, NONE, NOW)).toStrictEqual({
			ok: true,
			providerId: null,
		});
	});

	it('honours Retry-After on 429', () => {
		const result = classifyGraphResponse(429, {}, new Headers({ 'retry-after': '17' }), NOW);

		expect(result).toStrictEqual({
			code: 'graph.throttled',
			failure: 'transient',
			ok: false,
			retryAfterMs: 17_000,
		});
	});
});

function ndr(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		body: {
			content:
				'Delivery has failed to these recipients.\r\nbob@example.net\r\nRemote server said: 550 5.1.1 User unknown\r\n',
			contentType: 'text',
		},
		bodyPreview: 'Delivery has failed',
		id: 'AAMk-report-1',
		internetMessageHeaders: [
			{ name: 'In-Reply-To', value: '<orig-1@example.org>' },
			{ name: 'References', value: '<old@example.org> <orig-1@example.org>' },
		],
		receivedDateTime: '2026-11-25T09:30:00Z',
		...overrides,
	};
}

function plainBody(content: string): Record<string, unknown> {
	return { body: { content, contentType: 'text' } };
}

describe(parseNdr, () => {
	it('reads a hard bounce report', () => {
		expect(parseNdr(ndr())).toStrictEqual({
			hard: true,
			originalMessageId: '<orig-1@example.org>',
			receivedAt: new Date('2026-11-25T09:30:00Z'),
			reportId: 'AAMk-report-1',
		});
	});

	it('reads a soft bounce report', () => {
		const report = parseNdr(ndr(plainBody('Action: delayed\r\nStatus: 4.4.7\r\nMailbox full')));

		expect(report?.hard).toBe(false);
	});

	it('takes the status line over other numbers', () => {
		const message = ndr(plainBody('try 4.2.2 later\r\nStatus: 5.7.1\r\n'));

		expect(parseNdr(message)?.hard).toBe(true);
	});

	it('falls back to References', () => {
		const headers = [{ name: 'references', value: '<a@example.org> <b@example.org>' }];

		expect(parseNdr(ndr({ internetMessageHeaders: headers }))?.originalMessageId).toBe(
			'<b@example.org>',
		);
	});

	it('falls back to the quoted original header', () => {
		const content =
			'Status: 5.1.1\r\n\r\nReceived: x\r\nMessage-ID: <quoted-9@example.org>\r\nSubject: Hi';

		const report = parseNdr(ndr({ ...plainBody(content), internetMessageHeaders: [] }));

		expect(report?.originalMessageId).toBe('<quoted-9@example.org>');
	});

	it.each([
		['no status', ndr(plainBody('no code here'))],
		['no message id', ndr({ ...plainBody('Status: 5.1.1'), internetMessageHeaders: [] })],
		['an unreadable date', ndr({ receivedDateTime: 'nope' })],
		['a string', 'text'],
		['null', null],
		['an empty object', {}],
	])('returns null for %s', (_name, message) => {
		expect(parseNdr(message)).toBeNull();
	});
});

describe('graph transport fetchBounces', () => {
	const since = new Date('2026-11-25T08:00:00Z');
	const unreadable = { body: { content: 'hi' }, id: 'x', receivedDateTime: '2026-11-25T09:45:00Z' };

	it('returns the parsed reports and the latest date seen', async () => {
		const { deps } = setup(() => json(200, { value: [ndr(), unreadable] }));

		const result = await createGraphTransport(SETTINGS, MAILBOX, deps).fetchBounces?.(since, 50);

		expect(result?.reports).toHaveLength(1);
		expect(result?.until).toStrictEqual(new Date('2026-11-25T09:45:00Z'));
	});

	it('asks for reports of the inbox since a date', async () => {
		const { deps, requests } = setup(() => json(200, { value: [] }));

		await createGraphTransport(SETTINGS, MAILBOX, deps).fetchBounces?.(since, 50);

		const request = requestTo(requests, '/mailFolders/inbox/messages');
		expect(request.url).toBe(inboxBouncesUrl(MAILBOX_URL, since, 50));
		expect(request.url).toContain('REPORT.IPM.Note.NDR');
		expect(request.url).toContain('2026-11-25T08%3A00%3A00.000Z');
		expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
		expect(request.headers.get('prefer')).toBe('outlook.body-content-type="text"');
	});

	it('asks for everything without a date', () => {
		expect(inboxBouncesUrl(MAILBOX_URL, null, 10)).toContain('1970-01-01T00%3A00%3A00.000Z');
	});

	it('returns no date for an empty inbox', async () => {
		const { deps } = setup(() => json(200, { value: [] }));

		await expect(
			createGraphTransport(SETTINGS, MAILBOX, deps).fetchBounces?.(null, 10),
		).resolves.toStrictEqual({ reports: [], until: null });
	});

	it.each([
		[401, 'graph.unauthorized'],
		[403, 'graph.mailbox'],
	])('throws a code without a secret when graph refuses with %i', async (status, code) => {
		const { deps } = setup(() => json(status, { error: { message: SECRET } }));

		await expect(
			createGraphTransport(SETTINGS, MAILBOX, deps).fetchBounces?.(null, 10),
		).rejects.toThrow(new Error(code));
	});

	it('throws a code on a network error', async () => {
		await expect(
			createGraphTransport(SETTINGS, MAILBOX, DOWN).fetchBounces?.(null, 10),
		).rejects.toThrow(new Error('graph.network'));
	});
});

describe(checkMailboxRestriction, () => {
	it.each([
		[403, 'restricted'],
		[200, 'readable'],
		[500, 'unknown'],
		[404, 'unknown'],
	] as const)('answers %i with %s', async (status, expected) => {
		const { deps } = setup(() => json(status, {}));

		await expect(checkMailboxRestriction(SETTINGS, PROBE, deps)).resolves.toBe(expected);
	});

	it('asks for one message of the probe mailbox', async () => {
		const { deps, requests } = setup(() => json(200, { value: [] }));

		await checkMailboxRestriction(SETTINGS, PROBE, deps);

		expect(requests.at(-1)?.url).toBe(
			'https://graph.test/v1.0/users/probe%40example.org/messages?$top=1',
		);
	});

	it('is unknown when the token fails', async () => {
		const { deps } = setup(accepted, () => json(401, {}));

		await expect(checkMailboxRestriction(SETTINGS, PROBE, deps)).resolves.toBe('unknown');
	});

	it('is unknown on a network error', async () => {
		await expect(checkMailboxRestriction(SETTINGS, PROBE, DOWN)).resolves.toBe('unknown');
	});
});

describe('graph transport probe', () => {
	it('fetches a token and reports success', async () => {
		const { deps } = setup(accepted);

		await expect(createGraphTransport(SETTINGS, MAILBOX, deps).probe?.()).resolves.toStrictEqual({
			ok: true,
			providerId: null,
		});
	});

	it('reports a refused token', async () => {
		const { deps } = setup(accepted, () => json(400, { error: 'invalid_client' }));

		await expect(createGraphTransport(SETTINGS, MAILBOX, deps).probe?.()).resolves.toMatchObject({
			failure: 'unauthorized',
			ok: false,
		});
	});
});
