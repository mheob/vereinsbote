import { isRedirect, redirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vite-plus/test';

import { createRequestScope, releaseWhenBodyDone } from './request-scope';
import type { RequestScope } from './request-scope';

interface Setup {
	opened: object[];
	ended: object[];
	waited: Promise<unknown>[];
	scope: RequestScope<object>;
}

function setup(): Setup {
	const opened: object[] = [];
	const ended: object[] = [];
	const waited: Promise<unknown>[] = [];
	const scope = createRequestScope<object>({
		// oxlint-disable-next-line typescript/require-await -- the fake resolves immediately
		async create() {
			const value = {};
			opened.push(value);
			return {
				// oxlint-disable-next-line typescript/require-await -- the fake resolves immediately
				async end() {
					ended.push(value);
				},
				value,
			};
		},
		waitUntil(promise) {
			waited.push(promise);
		},
	});
	return { ended, opened, scope, waited };
}

describe('request scope', () => {
	it('shares one resource within a request', async () => {
		const { opened, scope } = setup();
		const request = {};
		const [first, second] = await Promise.all([scope.get(request), scope.get(request)]);
		expect(first).toBe(second);
		expect(opened).toHaveLength(1);
	});

	it('opens one resource per request', async () => {
		const { opened, scope } = setup();
		const first = await scope.get({});
		const second = await scope.get({});
		expect(first).not.toBe(second);
		expect(opened).toHaveLength(2);
	});

	it('ends each resource through waitUntil', async () => {
		const { ended, opened, scope, waited } = setup();
		const [a, b] = [{}, {}];
		await scope.get(a);
		await scope.get(b);
		await scope.release(a);
		await scope.release(b);
		await Promise.all(waited);
		expect(waited).toHaveLength(2);
		expect(ended).toStrictEqual(opened);
	});

	it('ignores a release without a resource', async () => {
		const { scope, waited } = setup();
		await scope.release({});
		expect(waited).toHaveLength(0);
	});

	it('throws on get after release and opens no new resource', async () => {
		const { opened, scope } = setup();
		const request = {};
		await scope.get(request);
		await scope.release(request);
		await expect(scope.get(request)).rejects.toThrow('ended');
		expect(opened).toHaveLength(1);
	});
});

function noop(): void {
	// nothing to release
}

describe('response body release', () => {
	const encoder = new TextEncoder();
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- rest array of a test helper
	const streamOf = (...chunks: string[]): ReadableStream<Uint8Array> =>
		new ReadableStream({
			pull(controller) {
				const chunk = chunks.shift();
				if (chunk === undefined) controller.close();
				else controller.enqueue(encoder.encode(chunk));
			},
		});

	it('releases only after the body is fully read', async () => {
		let calls = 0;
		const response = releaseWhenBodyDone(
			new Response(streamOf('a', 'b'), { headers: { 'x-test': '1' }, status: 201 }),
			() => {
				calls += 1;
			},
		);
		expect(response.status).toBe(201);
		expect(response.headers.get('x-test')).toBe('1');
		const reader = response.body?.getReader();
		await reader?.read();
		expect(calls).toBe(0);
		await reader?.read();
		expect(calls).toBe(0);
		await reader?.read();
		expect(calls).toBe(1);
	});

	it('passes the body through unchanged', async () => {
		const response = releaseWhenBodyDone(new Response(streamOf('ab', 'cd')), noop);
		await expect(response.text()).resolves.toBe('abcd');
	});

	it('releases once when the body is cancelled', async () => {
		let calls = 0;
		const response = releaseWhenBodyDone(new Response(streamOf('a', 'b')), () => {
			calls += 1;
		});
		await response.body?.cancel();
		expect(calls).toBe(1);
	});

	it('returns a redirect itself, so TanStack Start still resolves its target', () => {
		const toLogin = redirect({ to: '/login' });
		const response = releaseWhenBodyDone(toLogin, noop);
		expect(response).toBe(toLogin);
		expect(isRedirect(response)).toBe(true);
	});

	it('keeps the status and headers of a not-found page', () => {
		const page = new Response(streamOf('<h1>404</h1>'), {
			headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' },
			status: 404,
			statusText: 'Not Found',
		});
		const response = releaseWhenBodyDone(page, noop);
		expect([response.status, response.statusText]).toStrictEqual([404, 'Not Found']);
		expect(Object.fromEntries(response.headers)).toStrictEqual(Object.fromEntries(page.headers));
	});

	it('keeps the markers TanStack Start puts on a response with a body', () => {
		const marker = Symbol.for('tanstack-start:protected-response-headers');
		const transport = new Map([['content-type', 'application/json']]);
		const reply = Object.defineProperty(new Response(streamOf('{}')), marker, {
			configurable: true,
			value: transport,
		});
		const response = releaseWhenBodyDone(reply, noop);
		expect(response).not.toBe(reply);
		expect(Reflect.get(response, marker)).toBe(transport);
	});

	it('releases at once for a response without a body', () => {
		let calls = 0;
		releaseWhenBodyDone(new Response(null, { status: 204 }), () => {
			calls += 1;
		});
		expect(calls).toBe(1);
	});
});
