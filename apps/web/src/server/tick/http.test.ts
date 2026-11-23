import { describe, expect, it, vi } from 'vite-plus/test';

import type { Platform } from '@/platform/platform';
import { parseEnv } from '@/server/env';

import { handleTickRequest } from './http';
import type { CompletedTick, TickReport } from './tick';

const CRON_SECRET = 'c'.repeat(32);
const TICK_URL = 'https://bote.example.org/api/tick';

const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 5).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET,
	DATABASE_URL: 'postgres://x@localhost/x',
});

const platform: Platform = {
	name: 'node',
	waitUntil() {
		// Nothing to keep alive in these tests.
	},
};

function completed(moreWork: boolean): CompletedTick {
	return { finishedAt: '', moreWork, startedAt: '', status: 'completed', steps: [] };
}

function tickRequest(method: string, authorization?: string): Request {
	const headers = new Headers();
	if (authorization !== undefined) headers.set('authorization', authorization);
	return new Request(TICK_URL, { headers, method });
}

function authorizedPost(): Request {
	return tickRequest('POST', `Bearer ${CRON_SECRET}`);
}

describe(handleTickRequest, () => {
	it('rejects requests without the cron secret', async () => {
		const run = vi.fn<() => Promise<TickReport>>();
		const res = await handleTickRequest(tickRequest('POST'), { env, platform, run });
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
		const res = await handleTickRequest(tickRequest('POST', authorization), { env, platform, run });
		expect(res.status).toBe(401);
		expect(run).not.toHaveBeenCalled();
	});

	it('accepts GET with the bearer secret', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(false));
		const res = await handleTickRequest(tickRequest('GET', `Bearer ${CRON_SECRET}`), {
			env,
			platform,
			run,
		});
		expect(res.status).toBe(200);
		expect(run).toHaveBeenCalledOnce();
		await expect(res.json()).resolves.toStrictEqual(completed(false));
	});

	it('accepts POST with the bearer secret and answers with the report', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue({ status: 'locked' });
		const res = await handleTickRequest(authorizedPost(), { env, platform, run });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/json');
		expect(res.headers.get('cache-control')).toBe('no-store');
		await expect(res.json()).resolves.toStrictEqual({ status: 'locked' });
	});

	it('rejects other methods', async () => {
		const run = vi.fn<() => Promise<TickReport>>();
		const res = await handleTickRequest(tickRequest('PUT', `Bearer ${CRON_SECRET}`), {
			env,
			platform,
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
		const res = await handleTickRequest(authorizedPost(), { env, platform, run });
		expect(res.status).toBe(500);
		await expect(res.text()).resolves.not.toContain('secret');
		expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
		log.mockRestore();
	});

	it('chains one follow-up tick when more work is left', async () => {
		const waits: Promise<unknown>[] = [];
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response());
		const res = await handleTickRequest(authorizedPost(), {
			env,
			fetchFn,
			platform: {
				name: 'node',
				waitUntil: (promise) => {
					waits.push(promise);
				},
			},
			run: vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(true)),
		});
		await Promise.all(waits);
		expect(res.status).toBe(200);
		expect(waits).toHaveLength(1);
		expect(fetchFn).toHaveBeenCalledExactlyOnceWith(
			TICK_URL,
			expect.objectContaining({
				headers: { authorization: `Bearer ${CRON_SECRET}` },
				method: 'POST',
			}),
		);
	});

	it('swallows a failing follow-up request', async () => {
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const waits: Promise<unknown>[] = [];
		const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
		await handleTickRequest(authorizedPost(), {
			env,
			fetchFn,
			platform: {
				name: 'node',
				waitUntil: (promise) => {
					waits.push(promise);
				},
			},
			run: vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(true)),
		});
		await expect(Promise.all(waits)).resolves.toBeDefined();
		expect(log).toHaveBeenCalledWith('tick chain failed', 'TypeError');
		expect(JSON.stringify(log.mock.calls)).not.toContain(CRON_SECRET);
		log.mockRestore();
	});

	it('does not chain when no work is left', async () => {
		const waitUntil = vi.fn<Platform['waitUntil']>();
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response());
		const res = await handleTickRequest(authorizedPost(), {
			env,
			fetchFn,
			platform: { name: 'node', waitUntil },
			run: vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(false)),
		});
		expect(res.status).toBe(200);
		expect(waitUntil).not.toHaveBeenCalled();
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('does not chain when another tick holds the lock', async () => {
		const waitUntil = vi.fn<Platform['waitUntil']>();
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response());
		await handleTickRequest(authorizedPost(), {
			env,
			fetchFn,
			platform: { name: 'node', waitUntil },
			run: vi.fn<() => Promise<TickReport>>().mockResolvedValue({ status: 'locked' }),
		});
		expect(waitUntil).not.toHaveBeenCalled();
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
