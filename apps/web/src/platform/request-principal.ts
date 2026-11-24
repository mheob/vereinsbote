import { redirect } from '@tanstack/react-router';
import { getRequest } from '@tanstack/react-start/server';

import { LOGIN_PATH } from '@/paths';
import { getSessionUser } from '@/server/auth/session';
import { loadPrincipal } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { getAppContext } from './context';
import type { AppContext } from './context';

/**
 * The app context and the principal of the user signed in to the current request. Every server
 * function asks for it itself: server functions are reachable over HTTP without their page, so no
 * check of the page counts for them.
 *
 * @returns The context and the principal.
 * @throws {Redirect} To the sign-in page without a valid session or for a disabled user.
 */
async function requireRequestPrincipal(): Promise<{
	context: AppContext;
	principal: Principal;
}> {
	const context = await getAppContext();
	const user = await getSessionUser(context.auth, context.db, getRequest().headers);
	const principal = user === null ? null : await loadPrincipal(context.db, user.id);
	// oxlint-disable-next-line typescript/only-throw-error -- TanStack Start sends a thrown redirect to the client
	if (principal === null) throw redirect({ to: LOGIN_PATH });
	return { context, principal };
}

export { requireRequestPrincipal };
