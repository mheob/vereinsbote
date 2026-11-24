import { createMiddleware, createServerOnlyFn, createStart } from '@tanstack/react-start';

import { createServerFnCsrfMiddleware } from './platform/csrf';
import { releaseWhenBodyDone } from './platform/request-scope';
import { SECURITY_HEADERS } from './platform/security-headers';
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
 * Sets the security headers (`SECURITY_HEADERS`) on every response of the app. Through Start's
 * response helpers, which it applies to whatever response comes back: a new `Response` would lose
 * what Start keeps on its own (a redirect's target, the status of a not-found page).
 */
const securityHeaders = createMiddleware({ type: 'request' }).server(async ({ next }) => {
	const { setResponseHeaders } = await import('@tanstack/react-start/server');
	setResponseHeaders(new Headers(SECURITY_HEADERS));
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

// `securityHeaders` comes first, so it also covers the refusal of `csrf`; `releaseDb` comes before
// `csrf`, so it also ends a database that a later middleware opened.
export const startInstance = createStart(() => ({
	functionMiddleware: [hideServerFnErrors],
	requestMiddleware: [securityHeaders, releaseDb, csrf],
}));
