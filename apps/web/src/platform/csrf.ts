import { createCsrfMiddleware } from '@tanstack/react-start';

type CsrfMiddleware = ReturnType<typeof createCsrfMiddleware>;

/**
 * Protects every server function against cross-site requests (CSRF), with TanStack Start's own
 * CSRF middleware. A browser request passes when its `Sec-Fetch-Site` is `same-origin`; without
 * that header (older browsers) its `Origin`, else its `Referer`, must be the origin of `APP_URL`.
 * A request with none of them is rejected. A rejected request gets 403 and never reaches the
 * server function.
 *
 * Routes such as `/api/auth/*` are left alone: Better Auth checks the origin of its requests
 * itself.
 *
 * @param appOrigin Returns the origin of `APP_URL`, or a promise of it; called only for
 *   requests without `Sec-Fetch-Site`.
 * @returns The request middleware.
 */
function createServerFnCsrfMiddleware(appOrigin: () => Promise<string> | string): CsrfMiddleware {
	return createCsrfMiddleware({
		filter: ({ handlerType }) => handlerType === 'serverFn',
		origin: async (origin) => origin === (await appOrigin()),
	});
}

export { createServerFnCsrfMiddleware };
