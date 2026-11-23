import { createMiddleware, createStart } from '@tanstack/react-start';

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

export const startInstance = createStart(() => ({ requestMiddleware: [releaseDb] }));
