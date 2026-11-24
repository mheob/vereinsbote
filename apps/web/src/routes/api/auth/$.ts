import { createFileRoute } from '@tanstack/react-router';

import { getAppContext } from '@/platform/context';
import { handleAuthRequest } from '@/server/auth/auth';

/**
 * Hands every request under `/api/auth/` to Better Auth (login link, Microsoft, session).
 *
 * @param context The route handler context.
 * @param context.request The incoming request.
 * @returns Better Auth's response.
 */
async function handleAuth({ request }: Readonly<{ request: Request }>): Promise<Response> {
	const { auth } = await getAppContext();
	return handleAuthRequest(auth, request);
}

export const Route = createFileRoute('/api/auth/$')({
	server: { handlers: { GET: handleAuth, POST: handleAuth } },
});
