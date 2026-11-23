import { describe, expect, it, vi } from 'vite-plus/test';

import { MAX_CHAINED_TICKS } from '@/server/tick/chain';
import { TICK_BUDGET_MS } from '@/server/tick/tick';
import type { TickReport } from '@/server/tick/tick';

import { LAST_START_MS, runScheduledTicks } from './cloudflare-scheduled';

const START = Date.parse('2026-11-23T10:00:00.000Z');

function completed(moreWork: boolean): TickReport {
	return { finishedAt: '', moreWork, startedAt: '', status: 'completed', steps: [] };
}

describe(runScheduledTicks, () => {
	it('starts no tick later than 10 minutes into the 15-minute cron invocation', () => {
		expect(LAST_START_MS).toBe(10 * 60_000);
	});

	it('stops when no work is left', async () => {
		const run = vi
			.fn<() => Promise<TickReport>>()
			.mockResolvedValueOnce(completed(true))
			.mockResolvedValue(completed(false));
		await expect(runScheduledTicks(run, () => START)).resolves.toBe(2);
	});

	it('stops when the wall time leaves no room for another budget', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(true));
		// Every tick uses its whole budget: ticks start at 0, 4 and 8 minutes, not at 12.
		const now = (): number => START + run.mock.calls.length * TICK_BUDGET_MS;
		await expect(runScheduledTicks(run, now)).resolves.toBe(3);
	});

	it('stops at the hop cap', async () => {
		const run = vi.fn<() => Promise<TickReport>>().mockResolvedValue(completed(true));
		await expect(runScheduledTicks(run, () => START)).resolves.toBe(1 + MAX_CHAINED_TICKS);
	});
});
