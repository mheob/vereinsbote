import { describe, expect, it } from 'vite-plus/test';

import { tickSteps } from './steps';

describe('the steps of a tick', () => {
	it('runs the steps in the order of the plan (sending before warnings)', () => {
		expect(tickSteps.map((step) => step.name)).toStrictEqual([
			'prune-auth-records',
			'outbox',
			'attachment-cleanup',
			'stale-import-warning',
			'sending-warnings',
		]);
	});
});
