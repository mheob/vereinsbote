import type { Db } from '@/server/db/client';
import { findUserById } from '@/server/users/repo';

import type { Auth } from './auth';

interface SessionUser {
	id: string;
	email: string;
	name: string;
	isAdmin: boolean;
}

/**
 * Returns the signed-in user of a request. The user is read from the database on every call, so
 * a user disabled after signing in is signed out on the next request.
 *
 * @param auth The auth instance.
 * @param db The database.
 * @param headers The request headers with the session cookie.
 * @returns The user, or null without a valid session or when the user is disabled.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients and Headers are mutable class instances
async function getSessionUser(auth: Auth, db: Db, headers: Headers): Promise<SessionUser | null> {
	const current = await auth.api.getSession({ headers });
	if (current === null) return null;
	const found = await findUserById(db, current.user.id);
	if (found === null || found.status === 'disabled') return null;
	return { email: found.email, id: found.id, isAdmin: found.isAdmin, name: found.name };
}

export { getSessionUser };
export type { SessionUser };
