import { describe, expect, it } from 'vite-plus/test';

import { kickSteps, tickSteps } from './steps';

describe('the steps of a tick', () => {
	it('runs the steps in the order of the plan (sending, bounces, deletions, warnings)', () => {
		expect(tickSteps.map((step) => step.name)).toStrictEqual([
			'prune-auth-records',
			'outbox',
			'graph-bounces',
			'attachment-cleanup',
			'stale-import-warning',
			'sending-warnings',
		]);
	});

	it('runs only the outbox step of the ticks right after a confirmation', () => {
		expect(kickSteps).toStrictEqual([tickSteps[1]]);
	});
});
