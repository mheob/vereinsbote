import type { Platform } from '@/platform/platform';
import { secretsMatch } from '@/server/crypto/constant-time';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';

import type { TickReport } from './tick';

interface TickRequestDeps {
	env: Env;
	platform: Platform;
	/** Runs one tick; called only for an authorized request. */
	run: () => Promise<TickReport>;
	fetchFn?: typeof fetch;
}

const ALLOWED_METHODS = new Set(['GET', 'POST']);
const NO_STORE = { 'cache-control': 'no-store' };

const defaultFetch: typeof fetch = async (input, init) => fetch(input, init);

/**
 * Asks for the next tick right away. Never rejects: a failed request is only logged, by error
 * name, without the URL or the secret; the next scheduled tick picks the work up anyway.
 *
 * @param fetchFn The fetch implementation.
 * @param url The tick URL.
 * @param authorization The verified `Authorization` header.
 */
async function requestNextTick(
	fetchFn: typeof fetch,
	url: string,
	authorization: string,
): Promise<void> {
	try {
		const response = await fetchFn(url, { headers: { authorization }, method: 'POST' });
		await response.body?.cancel();
	} catch (error) {
		// oxlint-disable-next-line no-console -- name or code only, the next scheduled tick follows
		console.error('tick chain failed', errorLabel(error));
	}
}

/**
 * Runs the tick and answers with its report. When work is left, it requests one follow-up tick
 * in the background, with the same `Authorization` header.
 *
 * @param deps The environment, the platform, the tick runner and an optional fetch.
 * @param authorization The verified `Authorization` header.
 * @returns 200 with the report, or 500 without details when the tick failed.
 */
async function runAndChain(
	deps: Readonly<TickRequestDeps>,
	authorization: string,
): Promise<Response> {
	const { env, fetchFn = defaultFetch, platform, run } = deps;
	try {
		const report = await run();
		if (report.status === 'completed' && report.moreWork) {
			const url = new URL('/api/tick', env.appUrl).toString();
			platform.waitUntil(requestNextTick(fetchFn, url, authorization));
		}
		return Response.json(report, { headers: NO_STORE });
	} catch (error) {
		// oxlint-disable-next-line no-console -- name or code only, the message may carry details
		console.error('tick failed', errorLabel(error));
		return new Response(null, { headers: NO_STORE, status: 500 });
	}
}

/**
 * Handles `/api/tick` (GET from Vercel Cron, POST from the self-chaining). Requires
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time; then runs a tick and
 * answers with its report.
 *
 * @param request The incoming request.
 * @param deps The environment, the platform, the tick runner and an optional fetch.
 * @returns 401 without the secret, 405 for other methods, otherwise the tick's response.
 */
async function handleTickRequest(
	request: Request,
	deps: Readonly<TickRequestDeps>,
): Promise<Response> {
	const authorization = request.headers.get('authorization') ?? '';
	if (!(await secretsMatch(authorization, `Bearer ${deps.env.cronSecret}`))) {
		return new Response(null, { headers: NO_STORE, status: 401 });
	}
	if (!ALLOWED_METHODS.has(request.method)) {
		return new Response(null, { headers: { ...NO_STORE, allow: 'GET, POST' }, status: 405 });
	}
	return runAndChain(deps, authorization);
}

export { handleTickRequest };
export type { TickRequestDeps };
