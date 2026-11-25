import { describe, expect, it } from 'vite-plus/test';

import { cspNonceFor } from './csp-nonce';

describe(cspNonceFor, () => {
	it('keeps one nonce per request and differs between requests', () => {
		const first = {};
		const second = {};
		expect(cspNonceFor(first)).toBe(cspNonceFor(first));
		expect(cspNonceFor(first)).not.toBe(cspNonceFor(second));
		expect(cspNonceFor(first)).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
	});
});
