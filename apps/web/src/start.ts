import { createMiddleware, createStart } from '@tanstack/react-start';

/** Ends the request-scoped database (Cloudflare) once the response is produced. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the middleware context is a library type
const releaseDb = createMiddleware({ type: 'request' }).server(async ({ next }) => {
	try {
		return await next();
	} finally {
		const { releaseRequestDb } = await import('./platform/context');
		await releaseRequestDb();
	}
});

export const startInstance = createStart(() => ({ requestMiddleware: [releaseDb] }));
