import { createFileRoute } from '@tanstack/react-router';

import { getAppContext } from '@/platform/context';

/**
 * Hands every request under `/api/auth/` to Better Auth (login link, Microsoft, session).
 *
 * @param context The route handler context.
 * @param context.request The incoming request.
 * @returns Better Auth's response.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Request cannot be made readonly
async function handleAuth({ request }: Readonly<{ request: Request }>): Promise<Response> {
	const { auth } = await getAppContext();
	return auth.handler(request);
}

export const Route = createFileRoute('/api/auth/$')({
	server: { handlers: { GET: handleAuth, POST: handleAuth } },
});
