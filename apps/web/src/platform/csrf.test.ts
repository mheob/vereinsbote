import { setResponseHeaders } from '@tanstack/react-start/server';
import { describe, expect, it, vi } from 'vite-plus/test';

import { parseEnv } from '@/server/env';
import { startInstance } from '@/start';

import type { getAppEnv } from './context';
import { cspNonceFor } from './csp-nonce';
import { createServerFnCsrfMiddleware } from './csrf';
import { securityHeadersFor } from './security-headers';

// Start's response helpers need its request context, which the stand-in executor has not.
vi.mock(import('@tanstack/react-start/server'), async (importOriginal) => ({
	...(await importOriginal()),
	setResponseHeaders: vi.fn<typeof setResponseHeaders>(),
}));

// The security headers read the app's URL, and the stand-in has no environment.
vi.mock(import('./context'), async (importOriginal) => ({
	...(await importOriginal()),
	getAppEnv: vi.fn<typeof getAppEnv>().mockResolvedValue(
		parseEnv({
			APP_SECRET: Buffer.alloc(32, 5).toString('base64'),
			APP_URL: 'https://bote.example.org',
			CRON_SECRET: 'c'.repeat(32),
			DATABASE_URL: 'postgres://x@localhost/x',
		}),
	),
}));

const APP_ORIGIN = 'https://bote.example.org';
const SERVER_FN_URL = `${APP_ORIGIN}/_serverFn/save-locale`;
const FORBIDDEN = 403;
const OK = 200;

type HandlerType = 'router' | 'serverFn';

interface Outcome {
	/** The status of the response. */
	status: number;
	/** Whether the request reached the handler behind the middlewares. */
	handled: boolean;
}

interface StepResult {
	response: Response;
}

/** The part of a request middleware's `server` function the runner uses. */
type Step = (
	options: Readonly<{
		context: undefined;
		handlerType: HandlerType;
		next: () => Promise<StepResult>;
		pathname: string;
		request: Request;
	}>,
) => Promise<StepResult | Response> | StepResult | Response;

/**
 * Narrows the `server` function of a request middleware to what the runner calls.
 *
 * @param server The `server` option of a request middleware.
 * @returns The function, or undefined when the middleware has none.
 */
function asStep(server: unknown): Step | undefined {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Start types `next` generically over the context, which a stand-in executor cannot express
	return server as Step | undefined;
}

/**
 * Runs a request through request middlewares the way TanStack Start does: each `next` calls the
 * following middleware, the last `next` the handler, which answers 200.
 *
 * @param steps The `server` functions of the request middlewares, outermost first.
 * @param request The request.
 * @param handlerType Whether Start handles the request as a server function or with the router.
 * @returns The status and whether the handler ran.
 */
async function runMiddlewares(
	steps: readonly (Step | undefined)[],
	request: Request,
	handlerType: HandlerType,
): Promise<Outcome> {
	let handled = false;
	const { pathname } = new URL(request.url);
	const run = async (index: number): Promise<StepResult> => {
		if (index === steps.length) {
			handled = true;
			return { response: new Response('ok', { status: OK }) };
		}
		const step = steps[index];
		if (step === undefined) return run(index + 1);
		const result = await step({
			context: undefined,
			handlerType,
			next: async () => run(index + 1),
			pathname,
			request,
		});
		return result instanceof Response ? { response: result } : result;
	};
	const { response } = await run(0);
	return { handled, status: response.status };
}

/**
 * Runs a request through the request middlewares of the app (`src/start.ts`).
 *
 * @param request The request.
 * @param handlerType Whether Start handles the request as a server function or with the router.
 * @returns The status and whether the handler ran.
 */
async function runApp(request: Request, handlerType: HandlerType): Promise<Outcome> {
	const { requestMiddleware = [] } = await startInstance.getOptions();
	const steps = requestMiddleware.map((middleware) => asStep(middleware.options.server));
	return runMiddlewares(steps, request, handlerType);
}

/**
 * Runs a server function request through the CSRF middleware alone, with a fixed app origin.
 *
 * @param headers The request headers.
 * @returns The status and whether the handler ran.
 */
async function runCsrf(headers: Readonly<Record<string, string>>): Promise<Outcome> {
	const csrf = createServerFnCsrfMiddleware(() => APP_ORIGIN);
	const request = new Request(SERVER_FN_URL, { headers, method: 'POST' });
	return runMiddlewares([asStep(csrf.options.server)], request, 'serverFn');
}

const post = (url: string, headers: Readonly<Record<string, string>>): Request =>
	new Request(url, { body: '{}', headers, method: 'POST' });

describe('csrf protection of server functions', () => {
	describe('in the app', () => {
		it('rejects a cross-site POST to a server function', async () => {
			const request = post(SERVER_FN_URL, {
				origin: 'https://evil.example',
				'sec-fetch-site': 'cross-site',
			});
			await expect(runApp(request, 'serverFn')).resolves.toStrictEqual({
				handled: false,
				status: FORBIDDEN,
			});
		});

		it('passes a same-origin POST to a server function', async () => {
			const request = post(SERVER_FN_URL, { origin: APP_ORIGIN, 'sec-fetch-site': 'same-origin' });
			await expect(runApp(request, 'serverFn')).resolves.toStrictEqual({
				handled: true,
				status: OK,
			});
		});

		it('rejects a cross-site GET of a server function as well', async () => {
			const request = new Request(SERVER_FN_URL, { headers: { 'sec-fetch-site': 'cross-site' } });
			await expect(runApp(request, 'serverFn')).resolves.toStrictEqual({
				handled: false,
				status: FORBIDDEN,
			});
		});

		it('sets the security headers on every request, refused ones included', async () => {
			vi.mocked(setResponseHeaders).mockClear();
			const request = post(SERVER_FN_URL, {
				origin: 'https://evil.example',
				'sec-fetch-site': 'cross-site',
			});
			await expect(runApp(request, 'serverFn')).resolves.toMatchObject({ status: FORBIDDEN });
			const expected = securityHeadersFor('page', { https: true, nonce: cspNonceFor(request) });
			// Headers compare by their entries.
			expect(vi.mocked(setResponseHeaders).mock.calls).toStrictEqual([[new Headers(expected)]]);
		});

		it('lets the one-click POST of an unsubscribe link through without cookies and Origin', async () => {
			vi.mocked(setResponseHeaders).mockClear();
			// A mail provider posts server to server (RFC 8058): no Origin, no Sec-Fetch-Site.
			const request = new Request(`${APP_ORIGIN}/unsubscribe/abc`, {
				body: 'List-Unsubscribe=One-Click',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				method: 'POST',
			});
			await expect(runApp(request, 'router')).resolves.toStrictEqual({ handled: true, status: OK });
			const expected = securityHeadersFor('unsubscribe', {
				https: true,
				nonce: cspNonceFor(request),
			});
			expect(vi.mocked(setResponseHeaders).mock.calls).toStrictEqual([[new Headers(expected)]]);
		});

		it('still refuses a call of a server function without Origin', async () => {
			// The form of the unsubscribe page calls server functions: they keep the check.
			const request = post(SERVER_FN_URL, {});
			await expect(runApp(request, 'serverFn')).resolves.toStrictEqual({
				handled: false,
				status: FORBIDDEN,
			});
		});

		it('leaves routes such as Better Auth to their own origin check', async () => {
			const request = post(`${APP_ORIGIN}/api/auth/sign-in/magic-link`, {
				origin: 'https://evil.example',
				'sec-fetch-site': 'cross-site',
			});
			await expect(runApp(request, 'router')).resolves.toStrictEqual({
				handled: true,
				status: OK,
			});
		});
	});

	describe('without Sec-Fetch-Site', () => {
		it('passes the origin of APP_URL', async () => {
			await expect(runCsrf({ origin: APP_ORIGIN })).resolves.toStrictEqual({
				handled: true,
				status: OK,
			});
		});

		it('rejects any other origin, even the same host over http', async () => {
			await expect(runCsrf({ origin: 'http://bote.example.org' })).resolves.toStrictEqual({
				handled: false,
				status: FORBIDDEN,
			});
		});

		it('checks the Referer when Origin is missing', async () => {
			await expect(runCsrf({ referer: `${APP_ORIGIN}/setup` })).resolves.toStrictEqual({
				handled: true,
				status: OK,
			});
			await expect(runCsrf({ referer: 'https://evil.example/setup' })).resolves.toStrictEqual({
				handled: false,
				status: FORBIDDEN,
			});
		});

		it('rejects the opaque origin null', async () => {
			await expect(runCsrf({ origin: 'null' })).resolves.toStrictEqual({
				handled: false,
				status: FORBIDDEN,
			});
		});

		it('rejects the APP_URL host on another port', async () => {
			await expect(runCsrf({ origin: 'https://bote.example.org:8443' })).resolves.toStrictEqual({
				handled: false,
				status: FORBIDDEN,
			});
		});

		it('rejects a request without Origin and Referer', async () => {
			await expect(runCsrf({})).resolves.toStrictEqual({ handled: false, status: FORBIDDEN });
		});
	});

	it('rejects a same-site request from another origin', async () => {
		await expect(
			runCsrf({ origin: 'https://other.example.org', 'sec-fetch-site': 'same-site' }),
		).resolves.toStrictEqual({ handled: false, status: FORBIDDEN });
	});
});
