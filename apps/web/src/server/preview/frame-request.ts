/*
 * The `/preview-frame` request, apart from the route: method check and the answer when the
 * settings cannot be read. Every answer carries the frame's security headers itself, so none falls
 * back to the server's own error page (a JSON 500 without them).
 */
import { cspNonceFor } from '@/platform/csp-nonce';
import { securityHeadersFor } from '@/platform/security-headers';
import { errorLabelWithCause } from '@/server/error-label';

import { previewFramePage } from './frame-page';

const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_UNAVAILABLE = 503;

/**
 * The frame's headers, with the nonce of the request: the same one the request middleware in
 * `start.ts` puts into the policy (`cspNonceFor` keeps one per request).
 *
 * @param request The request.
 * @returns The headers, by lowercase name.
 */
function frameHeaders(request: Request): Record<string, string> {
	return {
		...securityHeadersFor('previewFrame', { https: false, nonce: cspNonceFor(request) }),
		'cache-control': 'no-store',
	};
}

/**
 * Answers a request for the preview frame. Other methods than GET get 405; when the app's origin
 * cannot be read, an empty 503, logged by error label only.
 *
 * @param request The request.
 * @param appOrigin Reads the origin of `APP_URL`, the only sender the frame listens to.
 * @returns The frame page, 405 or 503.
 */
async function handlePreviewFrameRequest(
	request: Request,
	appOrigin: () => Promise<string>,
): Promise<Response> {
	const headers = frameHeaders(request);
	if (request.method !== 'GET') {
		return new Response(null, {
			headers: { ...headers, allow: 'GET' },
			status: HTTP_METHOD_NOT_ALLOWED,
		});
	}
	try {
		const page = previewFramePage(cspNonceFor(request), await appOrigin());
		return new Response(page, {
			headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
		});
	} catch (error) {
		// oxlint-disable-next-line no-console -- the label only; the next request tries again
		console.error('preview frame failed', errorLabelWithCause(error));
		return new Response(null, { headers, status: HTTP_UNAVAILABLE });
	}
}

export { handlePreviewFrameRequest };
