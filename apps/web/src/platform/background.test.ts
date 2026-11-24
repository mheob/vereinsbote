import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createBackgroundRunner } from './background';

// oxlint-disable-next-line typescript/require-await -- a failed piece of work, rejected at once
const failure = async (): Promise<never> => {
	throw Object.assign(new Error('token=abc params: anna@verein.de'), { code: 'EAUTH' });
};

describe(createBackgroundRunner, () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("hands the work to the runtime's waitUntil, never as a rejection", async () => {
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		const handed: Promise<unknown>[] = [];
		const run = createBackgroundRunner('vercel', () => (promise) => {
			handed.push(promise);
		});
		run(failure());
		expect(handed).toHaveLength(1);
		await expect(handed[0]).resolves.toBeUndefined();
		expect(logged).toHaveBeenCalledWith('background work failed', 'EAUTH');
		expect(JSON.stringify(logged.mock.calls)).not.toContain('@');
	});

	it('warns once on Vercel and Cloudflare when the runtime offers no waitUntil', async () => {
		const warned = vi.spyOn(console, 'warn').mockReturnValue();
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		for (const platform of ['vercel', 'cloudflare'] as const) {
			const run = createBackgroundRunner(platform, () => null);
			run(Promise.resolve());
			run(failure());
		}
		await vi.waitFor(() => {
			expect(logged).toHaveBeenCalledTimes(2);
		});
		expect(warned.mock.calls).toStrictEqual([
			['no waitUntil, work after the response may be cut short', 'vercel'],
			['no waitUntil, work after the response may be cut short', 'cloudflare'],
		]);
	});

	it('lets the work run on without a warning on Node', async () => {
		const warned = vi.spyOn(console, 'warn').mockReturnValue();
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		createBackgroundRunner('node', () => null)(failure());
		await vi.waitFor(() => {
			expect(logged).toHaveBeenCalledWith('background work failed', 'EAUTH');
		});
		expect(warned).not.toHaveBeenCalled();
	});
});
