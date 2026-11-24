import { describe, expect, it, vi } from 'vite-plus/test';

import type { Platform, PlatformName } from '@/platform/platform';
import { parseEnv } from '@/server/env';

import { MAX_CHAINED_TICKS } from './chain';
import { HOP_HEADER, handleTickRequest } from './http';
import type { CompletedTick, TickReport } from './tick';

const CRON_SECRET = 'c'.repeat(32);
const AUTHORIZATION = `Bearer ${CRON_SECRET}`;
const TICK_URL = 'https://bote.example.org/api/tick';

const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 5).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET,
	DATABASE_URL: 'postgres://x@localhost/x',
});

/** A platform that records what it is asked to keep alive. */
interface RecordingPlatform extends Platform {
	readonly waits: Promise<unknown>[];
}

function recordingPlatform(name: PlatformName = 'vercel'): RecordingPlatform {
	const waits: Promise<unknown>[] = [];
	return {
		name,
		waitUntil(promise) {
			waits.push(promise);
		},
		waits,
	};
}

function completed(moreWork: boolean): CompletedTick {
	return { finishedAt: '', moreWork, startedAt: '', status: 'completed', steps: [] };
}

function runReturning(report: TickReport): () => Promise<TickReport> {
	return vi.fn<() => Promise<TickReport>>().mockResolvedValue(report);
}

function acceptingFetch(): typeof fetch {
	return vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
}

/**
 * Builds a request to the tick endpoint.
 *
 * @param method The HTTP method.
 * @param headers The request headers.
 * @returns The request.
 */
function tickRequest(method: string, headers: Readonly<Record<string, string>> = {}): Request {
	return new Request(TICK_URL, { headers, method });
}

function authorizedPost(hop?: string): Request {
	const headers: Record<string, string> = { authorization: AUTHORIZATION };
	if (hop !== undefined) headers[HOP_HEADER] = hop;
	return tickRequest('POST', headers);
}

/**
 * Reads the `x-tick-hop` header of each chain request.
 *
 * @param fetchFn The fetch mock.
 * @returns The headers, in call order.
 */
function requestedHops(fetchFn: typeof fetch): (string | undefined)[] {
	return vi
		.mocked(fetchFn)
		.mock.calls.map(([, init]) => new Headers(init?.headers).get(HOP_HEADER) ?? undefined);
}

describe(handleTickRequest, () => {
	describe('authorization', () => {
		it('rejects requests without the cron secret', async () => {
			const run = vi.fn<() => Promise<TickReport>>();
			const res = await handleTickRequest(tickRequest('POST'), {
				env,
				platform: recordingPlatform(),
				run,
			});
			expect(res.status).toBe(401);
			expect(run).not.toHaveBeenCalled();
			await expect(res.text()).resolves.toBe('');
		});

		it.each([
			['a wrong secret', `Bearer ${'d'.repeat(32)}`],
			['a shorter secret', `Bearer ${'c'.repeat(31)}`],
			['a longer secret', `Bearer ${'c'.repeat(33)}`],
			['the secret without the scheme', CRON_SECRET],
			['another scheme', `Basic ${CRON_SECRET}`],
			['an empty header', ''],
		])('rejects %s', async (_case, authorization) => {
			const run = vi.fn<() => Promise<TickReport>>();
			const res = await handleTickRequest(tickRequest('POST', { authorization }), {
				env,
				platform: recordingPlatform(),
				run,
			});
			expect(res.status).toBe(401);
			expect(run).not.toHaveBeenCalled();
		});

		it('checks the secret before the hop header', async () => {
			const run = vi.fn<() => Promise<TickReport>>();
			const res = await handleTickRequest(tickRequest('POST', { [HOP_HEADER]: '1' }), {
				env,
				platform: recordingPlatform(),
				run,
			});
			expect(res.status).toBe(401);
			expect(run).not.toHaveBeenCalled();
		});
	});

	describe('first tick', () => {
		it('accepts GET with the bearer secret', async () => {
			const run = runReturning(completed(false));
			const res = await handleTickRequest(tickRequest('GET', { authorization: AUTHORIZATION }), {
				env,
				platform: recordingPlatform(),
				run,
			});
			expect(res.status).toBe(200);
			expect(run).toHaveBeenCalledOnce();
			await expect(res.json()).resolves.toStrictEqual(completed(false));
		});

		it('accepts POST with the bearer secret and answers with the report', async () => {
			const res = await handleTickRequest(authorizedPost(), {
				env,
				platform: recordingPlatform(),
				run: runReturning({ status: 'locked' }),
			});
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toContain('application/json');
			expect(res.headers.get('cache-control')).toBe('no-store');
			await expect(res.json()).resolves.toStrictEqual({ status: 'locked' });
		});

		it('rejects other methods', async () => {
			const run = vi.fn<() => Promise<TickReport>>();
			const res = await handleTickRequest(tickRequest('PUT', { authorization: AUTHORIZATION }), {
				env,
				platform: recordingPlatform(),
				run,
			});
			expect(res.status).toBe(405);
			expect(res.headers.get('allow')).toBe('GET, POST');
			expect(run).not.toHaveBeenCalled();
		});

		it('answers 500 without details when the tick fails', async () => {
			const log = vi.spyOn(console, 'error').mockReturnValue();
			const run = vi
				.fn<() => Promise<TickReport>>()
				.mockRejectedValue(new Error('connect ECONNREFUSED postgres://u:secret@db'));
			const res = await handleTickRequest(authorizedPost(), {
				env,
				platform: recordingPlatform(),
				run,
			});
			expect(res.status).toBe(500);
			await expect(res.text()).resolves.not.toContain('secret');
			expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
			log.mockRestore();
		});
	});

	describe('chaining on Vercel and Node', () => {
		it('chains one follow-up tick when more work is left', async () => {
			const platform = recordingPlatform();
			const fetchFn = acceptingFetch();
			const res = await handleTickRequest(authorizedPost(), {
				env,
				fetchFn,
				platform,
				run: runReturning(completed(true)),
			});
			await Promise.all(platform.waits);
			expect(res.status).toBe(200);
			expect(platform.waits).toHaveLength(1);
			expect(fetchFn).toHaveBeenCalledExactlyOnceWith(
				TICK_URL,
				expect.objectContaining({
					headers: { [HOP_HEADER]: '1', authorization: AUTHORIZATION },
					method: 'POST',
				}),
			);
		});

		it('waits for the follow-up request with a timeout', async () => {
			const platform = recordingPlatform();
			const fetchFn = acceptingFetch();
			await handleTickRequest(authorizedPost(), {
				env,
				fetchFn,
				platform,
				run: runReturning(completed(true)),
			});
			await Promise.all(platform.waits);
			const [[, init] = []] = vi.mocked(fetchFn).mock.calls;
			expect(init?.signal).toBeInstanceOf(AbortSignal);
		});

		it('answers a chained request with 202 before its tick finishes', async () => {
			const platform = recordingPlatform();
			const fetchFn = acceptingFetch();
			const gate = Promise.withResolvers<TickReport>();
			const run = vi.fn<() => Promise<TickReport>>().mockReturnValue(gate.promise);
			const res = await handleTickRequest(authorizedPost('3'), { env, fetchFn, platform, run });
			expect(res.status).toBe(202);
			await expect(res.json()).resolves.toStrictEqual({ status: 'accepted' });
			expect(platform.waits).toHaveLength(1);
			expect(fetchFn).not.toHaveBeenCalled();
		});

		it('runs a chained tick in waitUntil and requests the next hop', async () => {
			const platform = recordingPlatform();
			const fetchFn = acceptingFetch();
			const run = runReturning(completed(true));
			await handleTickRequest(authorizedPost('3'), { env, fetchFn, platform, run });
			await Promise.all(platform.waits);
			expect(run).toHaveBeenCalledOnce();
			expect(requestedHops(fetchFn)).toStrictEqual(['4']);
		});

		it('ends the chain at the hop cap', async () => {
			const platform = recordingPlatform();
			const fetchFn = acceptingFetch();
			const run = runReturning(completed(true));
			const hop = String(MAX_CHAINED_TICKS);
			const res = await handleTickRequest(authorizedPost(hop), { env, fetchFn, platform, run });
			await Promise.all(platform.waits);
			expect(res.status).toBe(202);
			expect(run).toHaveBeenCalledOnce();
			expect(fetchFn).not.toHaveBeenCalled();
		});

		it('logs a chained tick that fails, without details', async () => {
			const log = vi.spyOn(console, 'error').mockReturnValue();
			const platform = recordingPlatform();
			const fetchFn = acceptingFetch();
			const run = vi.fn<() => Promise<TickReport>>().mockRejectedValue(new Error('password=x'));
			await handleTickRequest(authorizedPost('1'), { env, fetchFn, platform, run });
			await Promise.all(platform.waits);
			expect(log).toHaveBeenCalledWith('tick failed', 'Error');
			expect(fetchFn).not.toHaveBeenCalled();
			log.mockRestore();
		});

		it.each(['9', '-1', 'x', '1.5', ''])('rejects the hop header %j', async (hop) => {
			const run = vi.fn<() => Promise<TickReport>>();
			const res = await handleTickRequest(authorizedPost(hop), {
				env,
				platform: recordingPlatform(),
				run,
			});
			expect(res.status).toBe(400);
			expect(run).not.toHaveBeenCalled();
		});

		it('swallows a failing follow-up request', async () => {
			const log = vi.spyOn(console, 'error').mockReturnValue();
			const platform = recordingPlatform();
			const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
			await handleTickRequest(authorizedPost(), {
				env,
				fetchFn,
				platform,
				run: runReturning(completed(true)),
			});
			await expect(Promise.all(platform.waits)).resolves.toBeDefined();
			expect(log).toHaveBeenCalledWith('tick chain failed', 'TypeError');
			expect(JSON.stringify(log.mock.calls)).not.toContain(CRON_SECRET);
			log.mockRestore();
		});

		it('logs a follow-up request that is not accepted', async () => {
			const log = vi.spyOn(console, 'error').mockReturnValue();
			const platform = recordingPlatform();
			const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
			await handleTickRequest(authorizedPost(), {
				env,
				fetchFn,
				platform,
				run: runReturning(completed(true)),
			});
			await Promise.all(platform.waits);
			expect(log).toHaveBeenCalledWith('tick chain failed', 'HTTP 503');
			log.mockRestore();
		});

		it('does not chain when no work is left', async () => {
			const platform = recordingPlatform();
			const fetchFn = acceptingFetch();
			const res = await handleTickRequest(authorizedPost(), {
				env,
				fetchFn,
				platform,
				run: runReturning(completed(false)),
			});
			expect(res.status).toBe(200);
			expect(platform.waits).toHaveLength(0);
			expect(fetchFn).not.toHaveBeenCalled();
		});

		it('does not chain when another tick holds the lock', async () => {
			const platform = recordingPlatform();
			const fetchFn = acceptingFetch();
			await handleTickRequest(authorizedPost(), {
				env,
				fetchFn,
				platform,
				run: runReturning({ status: 'locked' }),
			});
			expect(platform.waits).toHaveLength(0);
			expect(fetchFn).not.toHaveBeenCalled();
		});
	});

	describe('on Cloudflare', () => {
		it('never chains over HTTP', async () => {
			const platform = recordingPlatform('cloudflare');
			const fetchFn = acceptingFetch();
			const res = await handleTickRequest(authorizedPost(), {
				env,
				fetchFn,
				platform,
				run: runReturning(completed(true)),
			});
			expect(res.status).toBe(200);
			expect(platform.waits).toHaveLength(0);
			expect(fetchFn).not.toHaveBeenCalled();
		});

		it('runs a request with a hop header right away instead of in waitUntil', async () => {
			const platform = recordingPlatform('cloudflare');
			const run = runReturning(completed(true));
			const res = await handleTickRequest(authorizedPost('2'), { env, platform, run });
			expect(res.status).toBe(200);
			expect(run).toHaveBeenCalledOnce();
			expect(platform.waits).toHaveLength(0);
		});
	});
});
