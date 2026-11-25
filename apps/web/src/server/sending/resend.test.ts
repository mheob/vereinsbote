import { describe, expect, it } from 'vite-plus/test';

import {
	classifyResendResponse,
	createResendTransport,
	resendEndpoint,
} from '@/server/sending/resend';
import type { ResendDeps } from '@/server/sending/resend';
import type { OutgoingMail } from '@/server/sending/transport';

const NOW = new Date('2026-11-25T10:00:00Z');
const KEY = 're_test_invented_key_123';
const NONE = new Headers();

const MAIL: OutgoingMail = {
	attachments: [
		{ bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf', filename: 'a.pdf' },
	],
	bcc: 'archiv@example.org',
	from: { address: 'verein@example.org', name: 'Verein "Muster"' },
	html: '<p>Hallo</p>',
	idempotencyKey: 'send-1',
	kind: 'regular',
	listUnsubscribe: 'https://example.org/u/abc',
	messageId: '<abc@example.org>',
	replyTo: 'antwort@example.org',
	subject: 'Betreff',
	text: 'Hallo',
	to: 'mitglied@example.org',
};

interface Recorded {
	readonly url: string;
	readonly headers: Headers;
	readonly body: Record<string, unknown>;
	readonly hasSignal: boolean;
}

function parseBody(body: unknown): Record<string, unknown> {
	const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : {};
	return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
}

function setup(respond: () => Response | Error): { deps: ResendDeps; requests: Recorded[] } {
	const requests: Recorded[] = [];
	const fakeFetch: ResendDeps['fetch'] = async (input, init) => {
		await Promise.resolve();
		requests.push({
			body: parseBody(init?.body),
			hasSignal: init?.signal instanceof AbortSignal,
			headers: new Headers(init?.headers),
			url: typeof input === 'string' ? input : '',
		});
		const result = respond();
		if (result instanceof Error) throw result;
		return result;
	};
	return { deps: { endpoint: 'https://resend.test', fetch: fakeFetch, now: () => NOW }, requests };
}

describe(resendEndpoint, () => {
	it('uses the public API or the dev provider', () => {
		expect(resendEndpoint({ devProvidersUrl: null })).toBe('https://api.resend.com');
		expect(resendEndpoint({ devProvidersUrl: new URL('http://localhost:4000/') })).toBe(
			'http://localhost:4000/resend',
		);
	});
});

describe(createResendTransport, () => {
	it('has no probe and no bounce query', () => {
		const transport = createResendTransport(KEY, setup(() => Response.json({})).deps);
		expect(transport.probe).toBeNull();
		expect(transport.fetchBounces).toBeNull();
	});

	it('sends with an idempotency key and the unsubscribe headers', async () => {
		const { deps, requests } = setup(() => Response.json({ id: 'prov-1' }));
		const result = await createResendTransport(KEY, deps).send(MAIL);
		expect(result).toStrictEqual({ ok: true, providerId: 'prov-1' });
		const [request] = requests;
		expect([request?.url, request?.hasSignal]).toStrictEqual(['https://resend.test/emails', true]);
		expect(request?.headers.get('idempotency-key')).toBe('send-1');
		expect(request?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
		expect(request?.body).toMatchObject({
			attachments: [{ content: 'AQID', filename: 'a.pdf' }],
			from: '"Verein \'Muster\'" <verein@example.org>',
			headers: {
				'List-Unsubscribe': '<https://example.org/u/abc>',
				'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
				'Message-ID': '<abc@example.org>',
			},
			reply_to: 'antwort@example.org',
			to: ['mitglied@example.org'],
		});
	});

	it('adds the archive copy for regular mail only', async () => {
		const regular = setup(() => Response.json({ id: 'x' }));
		await createResendTransport(KEY, regular.deps).send(MAIL);
		expect(regular.requests[0]?.body.bcc).toStrictEqual(['archiv@example.org']);
		const system = setup(() => Response.json({ id: 'x' }));
		await createResendTransport(KEY, system.deps).send({ ...MAIL, kind: 'system' });
		expect(system.requests[0]?.body).not.toHaveProperty('bcc');
	});

	it('sends without an idempotency key when none is given', async () => {
		const { deps, requests } = setup(() => Response.json({ id: 'x' }));
		await createResendTransport(KEY, deps).send({ ...MAIL, idempotencyKey: null });
		expect(requests[0]?.headers.has('idempotency-key')).toBe(false);
	});

	it.each([
		['to', { to: 'a@example.org\r\nBcc: evil@example.org' }],
		['from', { from: { address: 'a b@example.org', name: 'X' } }],
		['bcc', { bcc: 'x@example.org\n' }],
		['replyTo', { replyTo: 'x@example.org\r' }],
		['listUnsubscribe', { listUnsubscribe: 'https://example.org/\r\nX: y' }],
		['messageId', { messageId: '<a@b>\r\nX: y' }],
	])('refuses an invalid %s without calling Resend', async (_name, patch) => {
		const { deps, requests } = setup(() => Response.json({ id: 'x' }));
		const result = await createResendTransport(KEY, deps).send({ ...MAIL, ...patch });
		expect(result).toMatchObject({ code: 'mime.address', failure: 'rejected', ok: false });
		expect(requests).toHaveLength(0);
	});

	it('refuses an invalid idempotency key', async () => {
		const { deps, requests } = setup(() => Response.json({ id: 'x' }));
		const result = await createResendTransport(KEY, deps).send({
			...MAIL,
			idempotencyKey: 'a\r\nb',
		});
		expect(result).toMatchObject({ failure: 'rejected', ok: false });
		expect(requests).toHaveLength(0);
	});

	it('maps a network error to transient without leaking the key', async () => {
		const { deps } = setup(() => new TypeError(`fetch failed ${KEY}`));
		const result = await createResendTransport(KEY, deps).send(MAIL);
		expect(result).toStrictEqual({
			code: 'resend.network',
			failure: 'transient',
			ok: false,
			retryAfterMs: null,
		});
		expect(JSON.stringify(result)).not.toContain(KEY);
	});
});

describe(classifyResendResponse, () => {
	it.each([
		['daily_quota_exceeded', 429, 'quota'],
		['monthly_quota_exceeded', 429, 'quota'],
		['rate_limit_exceeded', 429, 'transient'],
		['validation_error', 400, 'rejected'],
		['validation_error', 403, 'unauthorized'],
		['missing_api_key', 401, 'unauthorized'],
		['restricted_api_key', 403, 'unauthorized'],
		['concurrent_idempotent_requests', 409, 'transient'],
		['invalid_idempotent_request', 409, 'rejected'],
		['application_error', 500, 'transient'],
		['something_new', 503, 'transient'],
		['something_new', 422, 'rejected'],
	])('classifies %s (%i) as %s', (name, status, failure) => {
		expect(classifyResendResponse(status, { name }, NONE, NOW)).toMatchObject({
			failure,
			ok: false,
		});
	});

	it.each([
		[401, 'unauthorized'],
		[403, 'unauthorized'],
		[429, 'transient'],
		[500, 'transient'],
		[400, 'rejected'],
	])('classifies status %i without a body as %s', (status, failure) => {
		expect(classifyResendResponse(status, null, NONE, NOW)).toMatchObject({ failure, ok: false });
	});

	it('reads Retry-After for transient failures only', () => {
		const headers = new Headers({ 'retry-after': '7' });
		expect(
			classifyResendResponse(429, { name: 'rate_limit_exceeded' }, headers, NOW),
		).toMatchObject({
			retryAfterMs: 7000,
		});
		expect(
			classifyResendResponse(429, { name: 'daily_quota_exceeded' }, headers, NOW),
		).toMatchObject({
			retryAfterMs: null,
		});
	});

	it('never returns uncertain', () => {
		for (const status of [408, 500, 502, 503, 504]) {
			expect(classifyResendResponse(status, null, NONE, NOW)).not.toMatchObject({
				failure: 'uncertain',
			});
		}
	});

	it('takes a success without id as providerId null', () => {
		expect(classifyResendResponse(200, {}, NONE, NOW)).toStrictEqual({
			ok: true,
			providerId: null,
		});
	});
});
