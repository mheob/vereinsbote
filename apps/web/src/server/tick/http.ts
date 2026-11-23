import type { Platform } from '@/platform/platform';
import { secretsMatch } from '@/server/crypto/constant-time';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';

import { MAX_CHAINED_TICKS, wantsMore } from './chain';
import type { TickReport } from './tick';

interface TickRequestDeps {
	env: Env;
	platform: Platform;
	/** Runs one tick; called only for an authorized request. */
	run: () => Promise<TickReport>;
	fetchFn?: typeof fetch;
}

/** How many ticks of a chain came before this request; absent on the first tick (cron, manual). */
const HOP_HEADER = 'x-tick-hop';
const HOP_PATTERN = /^\d{1,2}$/u;
/** The chain request only waits for the 202 of the next tick, never for the tick itself. */
const CHAIN_REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_METHODS = new Set(['GET', 'POST']);
const NO_STORE = { 'cache-control': 'no-store' };

const defaultFetch: typeof fetch = async (input, init) => fetch(input, init);

/**
 * Reads the hop of a chained tick request.
 *
 * @param value The `x-tick-hop` header.
 * @returns 0 without the header, the hop for an integer from 0 to `MAX_CHAINED_TICKS`, otherwise null.
 */
function parseHop(value: string | null): number | null {
	if (value === null) return 0;
	if (!HOP_PATTERN.test(value)) return null;
	const hop = Number(value);
	return hop <= MAX_CHAINED_TICKS ? hop : null;
}

/** A tick of a chain: the verified `Authorization` header and how many ticks came before. */
interface ChainLink {
	authorization: string;
	hop: number;
}

/**
 * Requests the next tick of a chain. It waits only for the next tick's immediate 202, at most
 * `CHAIN_REQUEST_TIMEOUT_MS`. Never rejects: a failure is only logged, by error name or status,
 * without the URL or the secret; the next scheduled tick picks the work up anyway.
 *
 * @param deps The environment and the fetch implementation.
 * @param next The requested tick.
 */
async function requestTick(
	deps: Readonly<TickRequestDeps>,
	next: Readonly<ChainLink>,
): Promise<void> {
	const { env, fetchFn = defaultFetch } = deps;
	try {
		const response = await fetchFn(new URL('/api/tick', env.appUrl).toString(), {
			headers: { [HOP_HEADER]: String(next.hop), authorization: next.authorization },
			method: 'POST',
			signal: AbortSignal.timeout(CHAIN_REQUEST_TIMEOUT_MS),
		});
		await response.body?.cancel();
		if (!response.ok) {
			// oxlint-disable-next-line no-console -- the next scheduled tick follows
			console.error('tick chain failed', `HTTP ${response.status}`);
		}
	} catch (error) {
		// oxlint-disable-next-line no-console -- name or code only, the next scheduled tick follows
		console.error('tick chain failed', errorLabel(error));
	}
}

/**
 * The request for the next tick, when this one left work and the chain is below its cap.
 *
 * @param deps The request dependencies.
 * @param link The tick that produced the report.
 * @param report The tick's report.
 * @returns The pending request, or null when the chain ends here.
 */
function chainAfter(
	deps: Readonly<TickRequestDeps>,
	link: Readonly<ChainLink>,
	report: TickReport,
): Promise<void> | null {
	if (!wantsMore(report) || link.hop >= MAX_CHAINED_TICKS) return null;
	return requestTick(deps, { authorization: link.authorization, hop: link.hop + 1 });
}

/**
 * Runs a first tick and answers with its report. When the platform chains and work is left,
 * the next tick is requested in the background.
 *
 * @param deps The request dependencies.
 * @param link This tick (hop 0).
 * @param chains Whether this platform chains over HTTP.
 * @returns 200 with the report, or 500 without details when the tick failed.
 */
async function runAndAnswer(
	deps: Readonly<TickRequestDeps>,
	link: Readonly<ChainLink>,
	chains: boolean,
): Promise<Response> {
	try {
		const report = await deps.run();
		const next = chains ? chainAfter(deps, link, report) : null;
		if (next !== null) deps.platform.waitUntil(next);
		return Response.json(report, { headers: NO_STORE });
	} catch (error) {
		// oxlint-disable-next-line no-console -- name or code only, the message may carry details
		console.error('tick failed', errorLabel(error));
		return new Response(null, { headers: NO_STORE, status: 500 });
	}
}

/**
 * Runs a chained tick after its 202 was sent, then requests the next one if work is left.
 *
 * @param deps The request dependencies.
 * @param link This tick.
 */
async function runChained(
	deps: Readonly<TickRequestDeps>,
	link: Readonly<ChainLink>,
): Promise<void> {
	try {
		const report = await deps.run();
		await chainAfter(deps, link, report);
	} catch (error) {
		// oxlint-disable-next-line no-console -- name or code only, the message may carry details
		console.error('tick failed', errorLabel(error));
	}
}

/**
 * Checks the secret (in constant time), the method and the hop header of a tick request.
 *
 * @param request The incoming request.
 * @param env The environment.
 * @returns The tick to run, or the error response: 401, 405 or 400.
 */
async function admit(request: Request, env: Env): Promise<ChainLink | Response> {
	const authorization = request.headers.get('authorization') ?? '';
	if (!(await secretsMatch(authorization, `Bearer ${env.cronSecret}`))) {
		return new Response(null, { headers: NO_STORE, status: 401 });
	}
	if (!ALLOWED_METHODS.has(request.method)) {
		return new Response(null, { headers: { ...NO_STORE, allow: 'GET, POST' }, status: 405 });
	}
	const hop = parseHop(request.headers.get(HOP_HEADER));
	if (hop === null) return new Response(null, { headers: NO_STORE, status: 400 });
	return { authorization, hop };
}

/**
 * Handles `/api/tick`. Requires `Authorization: Bearer <CRON_SECRET>` and accepts GET (Vercel
 * Cron) and POST.
 *
 * - A first tick (no `x-tick-hop`, e.g. the cron) runs at once and answers 200 with its report.
 * - On Vercel and Node, a tick that leaves work requests the next one (`x-tick-hop` + 1, at most
 *   `MAX_CHAINED_TICKS`). That chained request answers 202 at once and runs its tick in
 *   `waitUntil`, so no invocation waits for another one's tick.
 * - Cloudflare never chains over HTTP (`waitUntil` ends 30 seconds after the response, and a
 *   Worker cannot reliably fetch itself); its cron handler runs follow-up ticks in-process.
 *
 * @param request The incoming request.
 * @param deps The environment, the platform, the tick runner and an optional fetch.
 * @returns 401 without the secret, 405 for other methods, 400 for an invalid hop, 202 for a
 * chained tick, otherwise 200 with the report.
 */
async function handleTickRequest(
	request: Request,
	deps: Readonly<TickRequestDeps>,
): Promise<Response> {
	const link = await admit(request, deps.env);
	if (link instanceof Response) return link;
	const chains = deps.platform.name !== 'cloudflare';
	if (link.hop === 0 || !chains) return runAndAnswer(deps, link, chains);
	deps.platform.waitUntil(runChained(deps, link));
	return Response.json({ status: 'accepted' }, { headers: NO_STORE, status: 202 });
}

export { HOP_HEADER, handleTickRequest };
export type { TickRequestDeps };
