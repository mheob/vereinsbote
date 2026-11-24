import { describe, expect, it, vi } from 'vite-plus/test';

import { MAX_CHAINED_TICKS, runTickChain } from './chain';
import type { TickReport } from './tick';

const START = Date.parse('2026-11-23T10:00:00.000Z');

function completed(moreWork: boolean): TickReport {
	return { finishedAt: '', moreWork, startedAt: '', status: 'completed', steps: [] };
}

describe(runTickChain, () => {
	it('runs one tick when no work is left', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(false));
		await expect(runTickChain({ run })).resolves.toBe(1);
		expect(run).toHaveBeenCalledOnce();
	});

	it('runs the next tick right away while work is left', async () => {
		const run = vi
			.fn<() => Promise<TickReport>>()
			.mockResolvedValueOnce(completed(true))
			.mockResolvedValueOnce(completed(true))
			.mockResolvedValue(completed(false));
		await expect(runTickChain({ run })).resolves.toBe(3);
	});

	it('stops after the hop cap of chained ticks', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(true));
		await expect(runTickChain({ run })).resolves.toBe(1 + MAX_CHAINED_TICKS);
		expect(MAX_CHAINED_TICKS).toBe(8);
	});

	it('stops when another tick holds the lock', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue({ status: 'locked' });
		await expect(runTickChain({ run })).resolves.toBe(1);
	});

	it('starts no tick after the start deadline', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(true));
		// Every tick takes one second.
		const now = (): number => START + run.mock.calls.length * 1000;
		await expect(runTickChain({ now, run, startDeadline: START + 2500 })).resolves.toBe(3);
	});
});
