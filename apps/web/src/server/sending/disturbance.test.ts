import { describe, expect, it } from 'vite-plus/test';

import { disturbanceReason } from './disturbance';

describe(disturbanceReason, () => {
	it.each([
		['graph.unauthorized', 'credentials'],
		['resend.unauthorized', 'credentials'],
		['outbox.credentials', 'credentials'],
		[null, 'credentials'],
		['graph.mailbox', 'mailbox'],
		['resend.domain', 'domain'],
	] as const)('reads %s as %s', (code, reason) => {
		expect(disturbanceReason(code)).toBe(reason);
	});
});
