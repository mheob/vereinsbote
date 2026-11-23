import { createMiddleware, createServerOnlyFn, createStart } from '@tanstack/react-start';

import { createServerFnCsrfMiddleware } from './platform/csrf';
import { releaseWhenBodyDone } from './platform/request-scope';

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

/** The origin of `APP_URL`; the server module stays out of the client bundle. */
const appOrigin = createServerOnlyFn(async (): Promise<string> => {
	const { getAppEnv } = await import('./platform/context');
	const { appUrl } = await getAppEnv();
	return appUrl.origin;
});

/** Rejects cross-site calls of server functions with 403 (see `createServerFnCsrfMiddleware`). */
const csrf = createServerFnCsrfMiddleware(appOrigin);

// `releaseDb` comes first, so it also ends a database that a later middleware opened.
export const startInstance = createStart(() => ({ requestMiddleware: [releaseDb, csrf] }));
