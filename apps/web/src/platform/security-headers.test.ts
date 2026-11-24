import { describe, expect, it } from 'vite-plus/test';

import { BASE_SECURITY_HEADERS, headerRouteOf, securityHeadersFor } from './security-headers';
import type { HeaderRoute } from './security-headers';

describe(securityHeadersFor, () => {
	it('sends a nonce-based page policy without unsafe-eval', () => {
		const headers = securityHeadersFor('page', { https: true, nonce: 'abc' });
		const csp = headers['content-security-policy'];
		expect(csp).toContain("script-src 'nonce-abc' 'strict-dynamic'");

		expect(csp).toContain("style-src-attr 'unsafe-inline'");
		expect(csp).toContain("default-src 'self'");
		expect(csp).not.toMatch(/unsafe-eval/u);
	});

	it('forbids framing, workers and plugins on a page', () => {
		const headers = securityHeadersFor('page', { https: true, nonce: 'abc' });
		const csp = headers['content-security-policy'];
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("worker-src 'none'");
		expect(csp).toContain("object-src 'none'");
		expect(headers['x-frame-options']).toBe('DENY');
	});

	it('upgrades insecure requests only on https', () => {
		const csp = securityHeadersFor('page', { https: false, nonce: 'abc' })[
			'content-security-policy'
		];
		expect(csp).not.toContain('upgrade-insecure-requests');
	});

	it('lets only the app frame the preview', () => {
		const headers = securityHeadersFor('previewFrame', { https: true, nonce: 'abc' });
		const csp = headers['content-security-policy'];
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("script-src 'nonce-abc'");
		expect(csp).toContain("style-src 'unsafe-inline'");
		expect(csp).toContain("img-src 'self' https:");
		expect(csp).toContain("frame-ancestors 'self'");
	});

	it('keeps the base headers on the preview frame, but allows framing by the app', () => {
		const headers = securityHeadersFor('previewFrame', { https: true, nonce: 'abc' });
		expect(headers['x-frame-options']).toBe('SAMEORIGIN');
		expect(headers['referrer-policy']).toBe(BASE_SECURITY_HEADERS['referrer-policy']);
	});

	it('sandboxes images', () => {
		const headers = securityHeadersFor('media', { https: true, nonce: 'abc' });
		expect(headers['content-security-policy']).toBe("default-src 'none'; sandbox");
		expect(headers['cross-origin-resource-policy']).toBe('cross-origin');
		expect(headers['x-content-type-options']).toBe('nosniff');
	});
});

describe(headerRouteOf, () => {
	it.each<[string, HeaderRoute]>([
		['/preview-frame', 'previewFrame'],
		['/media/abc.png', 'media'],
		['/', 'page'],
		['/mediathek', 'page'],
		['/preview-frame/x', 'page'],
	])('routes %s to %s', (pathname, route) => {
		expect(headerRouteOf(pathname)).toBe(route);
	});
});
