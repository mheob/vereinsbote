/**
 * The security headers every response has: no page may be framed (clickjacking), no response is
 * sniffed as another type, and other sites get the origin only as referrer. The built assets
 * (`static-headers.ts`) keep exactly these, because a static file has no nonce to put in a policy.
 */
const BASE_SECURITY_HEADERS = {
	'content-security-policy': "frame-ancestors 'none'",
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
} as const;

/** The kinds of response whose security headers differ (Design 17). */
type HeaderRoute = 'page' | 'previewFrame' | 'media';

const PREVIEW_FRAME_PATH = '/preview-frame';
const MEDIA_PREFIX = '/media/';

/**
 * The kind of response a path gives, for its security headers.
 *
 * @param pathname The path of the request.
 * @returns `previewFrame` for the preview frame, `media` for the images, else `page`.
 */
function headerRouteOf(pathname: string): HeaderRoute {
	if (pathname === PREVIEW_FRAME_PATH) return 'previewFrame';
	if (pathname.startsWith(MEDIA_PREFIX)) return 'media';
	return 'page';
}

function pagePolicy(nonce: string, https: boolean): string {
	const directives = [
		"default-src 'self'",
		`script-src 'nonce-${nonce}' 'strict-dynamic'`,
		`style-src-elem 'self' 'nonce-${nonce}'`,
		// React Aria Components render style attributes on the server (e.g. `VisuallyHidden`).
		"style-src-attr 'unsafe-inline'",
		"img-src 'self' blob: data:",
		"font-src 'self'",
		"connect-src 'self'",
		"frame-src 'self'",
		"worker-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	];
	if (https) directives.push('upgrade-insecure-requests');
	return directives.join('; ');
}

// `img-src https:` only so the preview shows the external images of imported templates (the
// import warns about them).
function previewFramePolicy(nonce: string): string {
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}'`,
		"style-src 'unsafe-inline'",
		"img-src 'self' https:",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'self'",
	].join('; ');
}

/**
 * The security headers of one kind of response. The request middleware in `start.ts` sets them,
 * and only the preview frame and the images differ from the pages.
 *
 * @param route The kind of response.
 * @param options The request's CSP nonce, and whether `APP_URL` is `https:`.
 * @returns The headers, by lowercase name.
 */
function securityHeadersFor(
	route: HeaderRoute,
	options: Readonly<{ nonce: string; https: boolean }>,
): Record<string, string> {
	const { https, nonce } = options;
	if (route === 'media') {
		return {
			...BASE_SECURITY_HEADERS,
			'content-security-policy': "default-src 'none'; sandbox",
			'cross-origin-resource-policy': 'cross-origin',
		};
	}
	if (route === 'previewFrame') {
		return {
			...BASE_SECURITY_HEADERS,
			'content-security-policy': previewFramePolicy(nonce),
			'x-frame-options': 'SAMEORIGIN',
		};
	}
	return { ...BASE_SECURITY_HEADERS, 'content-security-policy': pagePolicy(nonce, https) };
}

export { BASE_SECURITY_HEADERS, headerRouteOf, securityHeadersFor };
export type { HeaderRoute };
