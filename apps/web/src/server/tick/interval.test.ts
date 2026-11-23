import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { MAX_CHAINED_TICKS } from './chain';
import { startTickInterval } from './interval';
import type { TickReport } from './tick';

const INTERVAL_MS = 60_000;

function completed(moreWork: boolean): TickReport {
	return { finishedAt: '', moreWork, startedAt: '', status: 'completed', steps: [] };
}

describe(startTickInterval, () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('runs a tick every interval, not at once', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(false));
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

	it('starts the next tick at once when work is left', async () => {
		const run = vi
			.fn<() => Promise<TickReport>>()
			.mockResolvedValueOnce(completed(true))
			.mockResolvedValue(completed(false));
		const stop = startTickInterval({ intervalMs: INTERVAL_MS, run });
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledTimes(2);
		stop();
	});

	it('stops chaining at the hop cap until the next interval', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(true));
		const stop = startTickInterval({ intervalMs: INTERVAL_MS, run });
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledTimes(1 + MAX_CHAINED_TICKS);
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledTimes(2 * (1 + MAX_CHAINED_TICKS));
		stop();
	});

	it('skips an interval while the previous run is in flight', async () => {
		const pending = Promise.withResolvers<TickReport>();
		const run = vi
			.fn<() => Promise<TickReport>>()
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValue(completed(false));
		const stop = startTickInterval({ intervalMs: INTERVAL_MS, run });
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
		expect(run).toHaveBeenCalledOnce();
		pending.resolve(completed(false));
		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(run).toHaveBeenCalledTimes(2);
		stop();
	});

	it('keeps running after a failed tick and logs only the error name', async () => {
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const run = vi
			.fn<() => Promise<TickReport>>()
			.mockRejectedValueOnce(new Error('password=secret'))
			.mockResolvedValue(completed(false));
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
