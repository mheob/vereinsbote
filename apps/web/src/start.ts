// oxlint-disable-next-line import/no-unassigned-import -- zod's settings must be in place before any schema parses
import './zod-config';
import { createMiddleware, createServerOnlyFn, createStart } from '@tanstack/react-start';

import { formBodyLimit } from './platform/body-limit';
import { cspNonceFor } from './platform/csp-nonce';
import { createServerFnCsrfMiddleware } from './platform/csrf';
import { releaseWhenBodyDone } from './platform/request-scope';
import { headerRouteOf, securityHeadersFor } from './platform/security-headers';
import { publicError } from './platform/server-fn-errors';

/** Ends the request-scoped database (Cloudflare) once the response body is done. */
const releaseDb = createMiddleware({ type: 'request' }).server(async ({ next }) => {
	const { requestDbReleaser } = await import('./platform/context');
	const release = requestDbReleaser();
	if (release === null) return next();
	try {
		// oxlint-disable-next-line node/callback-return -- `next` continues the middleware chain, it is not a Node callback
		const { response } = await next();
		return releaseWhenBodyDone(response, release);
	} catch (error) {
		await release();
		throw error;
	}
});

/**
 * Sets the security headers (`securityHeadersFor`, with the request's Content Security Policy
 * nonce) on every response of the app; only the preview frame and `/media` differ from the pages.
 * Through Start's response helpers, which it applies to whatever response comes back: a new
 * `Response` would lose what Start keeps on its own (a redirect's target, the status of a
 * not-found page).
 */
const securityHeaders = createMiddleware({ type: 'request' }).server(async ({ next, request }) => {
	const { setResponseHeaders } = await import('@tanstack/react-start/server');
	const { getAppEnv } = await import('./platform/context');
	const { appUrl } = await getAppEnv();
	const { pathname } = new URL(request.url);
	const headers = securityHeadersFor(headerRouteOf(pathname), {
		https: appUrl.protocol === 'https:',
		nonce: cspNonceFor(request),
	});
	setResponseHeaders(new Headers(headers));
	return next();
});

/** The origin of `APP_URL`; the server module stays out of the client bundle. */
const appOrigin = createServerOnlyFn(async (): Promise<string> => {
	const { getAppEnv } = await import('./platform/context');
	const { appUrl } = await getAppEnv();
	return appUrl.origin;
});

/** Rejects cross-site calls of server functions with 403 (see `createServerFnCsrfMiddleware`). */
const csrf = createServerFnCsrfMiddleware(appOrigin);

/** Sends no internals of a failed server function to the client (see `publicError`). */
const hideServerFnErrors = createMiddleware({ type: 'function' }).server(async ({ next }) => {
	try {
		// oxlint-disable-next-line node/callback-return -- `next` continues the middleware chain, it is not a Node callback
		return await next();
	} catch (error) {
		// oxlint-disable-next-line typescript/only-throw-error -- a redirect or not-found result passes as thrown
		throw publicError(error);
	}
});

// `securityHeaders` comes first, so it also covers the refusals of `csrf` and `formBodyLimit`;
// `releaseDb` comes before `csrf`, so it also ends a database that a later middleware opened. A
// cross-site request is refused before its body is counted.
export const startInstance = createStart(() => ({
	functionMiddleware: [hideServerFnErrors],
	requestMiddleware: [securityHeaders, releaseDb, csrf, formBodyLimit],
}));
