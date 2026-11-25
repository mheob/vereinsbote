import { describe, expect, it } from 'vite-plus/test';

import { BASE_SECURITY_HEADERS } from './security-headers';
import { STATIC_ASSET_ROUTE_RULES, workersAssetHeadersFile } from './static-headers';

describe('the security headers of static assets', () => {
	it('gives Nitro (Node, Vercel) a route rule for the built assets', () => {
		expect(STATIC_ASSET_ROUTE_RULES).toStrictEqual({
			'/assets/**': { headers: { ...BASE_SECURITY_HEADERS } },
			'/social/**': { headers: { ...BASE_SECURITY_HEADERS } },
		});
	});

	it('writes every header into the `_headers` file of the Workers assets', () => {
		expect(workersAssetHeadersFile()).toBe(
			[
				'/assets/*',
				"  content-security-policy: frame-ancestors 'none'",
				'  referrer-policy: strict-origin-when-cross-origin',
				'  x-content-type-options: nosniff',
				'  x-frame-options: DENY',
				'/social/*',
				"  content-security-policy: frame-ancestors 'none'",
				'  referrer-policy: strict-origin-when-cross-origin',
				'  x-content-type-options: nosniff',
				'  x-frame-options: DENY',
				'',
			].join('\n'),
		);
	});
});
