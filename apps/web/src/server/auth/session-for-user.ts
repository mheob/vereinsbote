import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

/**
 * The endpoint contexts of `createSessionForUser` calls. The session hooks run inside the
 * endpoint that creates the session and get its context, so they can tell the setup's own
 * session from a sign-in (`closeSetupRecoveryFor`).
 */
const serverOpenedSessions = new WeakSet<object>();

/**
 * A server-only endpoint that opens a session for a user the app has identified itself (the
 * first admin, right after the setup). Better Auth never routes it over HTTP. It sets the
 * session cookie the way a sign-in does; the session hooks apply, so a disabled user gets none.
 */
const sessionForUser = {
	endpoints: {
		createSessionForUser: createAuthEndpoint.serverOnly(
			{ body: z.object({ userId: z.string() }), method: 'POST' },
			async (ctx) => {
				serverOpenedSessions.add(ctx);
				const { internalAdapter } = ctx.context;
				const found = await internalAdapter.findUserById(ctx.body.userId);
				// `createSession` returns null when the session hook refuses the user.
				const created = found === null ? null : await internalAdapter.createSession(found.id);
				if (found === null || created === null) throw new APIError('FORBIDDEN');
				await setSessionCookie(ctx, { session: created, user: found });
				return ctx.json({ userId: found.id });
			},
		),
	},
	id: 'session-for-user',
} satisfies BetterAuthPlugin;

/**
 * Tells whether a session is being created by `createSessionForUser`, from the endpoint context
 * Better Auth passes to the session hooks.
 *
 * @param context The endpoint context of the hook, or null outside an endpoint.
 * @returns True for the server's own session of the setup admin.
 */
function isServerOpenedSession(context: object | null): boolean {
	return context !== null && serverOpenedSessions.has(context);
}

export { isServerOpenedSession, sessionForUser };
