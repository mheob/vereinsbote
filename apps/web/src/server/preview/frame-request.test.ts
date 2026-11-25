import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { cspNonceFor } from '@/platform/csp-nonce';

import { handlePreviewFrameRequest } from './frame-request';

const FRAME_HEADERS = {
	'cache-control': 'no-store',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'SAMEORIGIN',
};

/**
 * A request for the frame.
 *
 * @param method The method.
 * @returns The request.
 */
function request(method: string): Request {
	return new Request('https://verein.example/preview-frame', { method });
}

describe(handlePreviewFrameRequest, () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('serves the frame page with the nonce of the request', async () => {
		const get = request('GET');
		const response = await handlePreviewFrameRequest(
			get,
			vi.fn<() => Promise<string>>().mockResolvedValue('https://verein.example'),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
		const nonce = cspNonceFor(get);
		expect(response.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
		await expect(response.text()).resolves.toContain(`<script nonce="${nonce}">`);
	});

	it('refuses other methods with 405 and the frame headers', async () => {
		const appOrigin = vi.fn<() => Promise<string>>();
		const response = await handlePreviewFrameRequest(request('POST'), appOrigin);
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET');
		expect(Object.fromEntries(response.headers)).toMatchObject(FRAME_HEADERS);
		expect(appOrigin).not.toHaveBeenCalled();
	});

	it('answers 503 with the frame headers when the settings fail, and logs the label only', async () => {
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const response = await handlePreviewFrameRequest(
			request('GET'),
			vi
				.fn<() => Promise<string>>()
				.mockRejectedValue(new TypeError('APP_URL=https://secret.example is invalid')),
		);
		expect(response.status).toBe(503);
		await expect(response.text()).resolves.toBe('');
		expect(Object.fromEntries(response.headers)).toMatchObject(FRAME_HEADERS);
		expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
		expect(log).toHaveBeenCalledExactlyOnceWith('preview frame failed', 'TypeError');
	});
});
