import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { startTickInterval } from './interval';

const INTERVAL_MS = 60_000;

describe(startTickInterval, () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('runs a tick every interval, not at once', async () => {
		const run = vi.fn<() => Promise<string>>().mockResolvedValue('done');
		const stop = startTickInterval({ intervalMs: INTERVAL_MS, run });
		expect(run).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledTimes(2);
		stop();
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('skips a run while the previous one is in flight', async () => {
		const pending = Promise.withResolvers<string>();
		const run = vi
			.fn<() => Promise<string>>()
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValue('done');
		const stop = startTickInterval({ intervalMs: INTERVAL_MS, run });
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
		expect(run).toHaveBeenCalledOnce();
		pending.resolve('done');
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledTimes(2);
		stop();
	});

	it('keeps running after a failed tick and logs only the error name', async () => {
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const run = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('password=secret'))
			.mockResolvedValue('done');
		const stop = startTickInterval({ intervalMs: INTERVAL_MS, run });
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledTimes(2);
		expect(log).toHaveBeenCalledWith('tick failed', 'Error');
		expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
		stop();
		log.mockRestore();
	});
});
