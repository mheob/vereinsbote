import { and, eq, sql } from 'drizzle-orm';

import { normalizeEmail } from '../auth/email';
import type { Db } from '../db/client';
import { session, user } from '../db/schema';
import type { userStatuses } from '../db/schema';

type UserStatus = (typeof userStatuses)[number];

interface UserRecord {
	id: string;
	email: string;
	name: string;
	isAdmin: boolean;
	status: UserStatus;
}

const userRecord = {
	email: user.email,
	id: user.id,
	isAdmin: user.isAdmin,
	name: user.name,
	status: user.status,
};

/**
 * Creates a user. The address is stored normalized; a second user with the same address fails
 * on the unique index on `lower(email)`.
 *
 * @param db The database.
 * @param input The user's address and name; `isAdmin` defaults to false, `status` to `invited`.
 * @returns The id of the new user.
 */
async function insertUser(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
	db: Db,
	input: Readonly<{ email: string; name: string; isAdmin?: boolean; status?: UserStatus }>,
): Promise<{ id: string }> {
	const [row] = await db
		.insert(user)
		.values({
			email: normalizeEmail(input.email),
			isAdmin: input.isAdmin ?? false,
			name: input.name,
			status: input.status ?? 'invited',
		})
		.returning({ id: user.id });
	if (row === undefined) throw new Error('Inserting the user returned no row.');
	return { id: row.id };
}

/**
 * Finds a user by address, in any spelling.
 *
 * @param db The database.
 * @param email The address as typed.
 * @returns The user, or null when no user has this address.
 */
async function findUserByEmail(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
	db: Db,
	email: string,
): Promise<{ id: string; status: UserStatus; isAdmin: boolean } | null> {
	const [row] = await db
		.select({ id: user.id, isAdmin: user.isAdmin, status: user.status })
		.from(user)
		.where(sql`lower(${user.email}) = ${normalizeEmail(email)}`);
	return row ?? null;
}

/**
 * Finds a user by id.
 *
 * @param db The database.
 * @param id The user id.
 * @returns The user, or null when there is none.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
async function findUserById(db: Db, id: string): Promise<UserRecord | null> {
	const [row] = await db.select(userRecord).from(user).where(eq(user.id, id));
	return row ?? null;
}

/**
 * Marks an invited user as active. Users with another status stay as they are.
 *
 * @param db The database.
 * @param id The user id.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
async function activateInvitedUser(db: Db, id: string): Promise<void> {
	await db
		.update(user)
		.set({ status: 'active' })
		.where(and(eq(user.id, id), eq(user.status, 'invited')));
}

/**
 * Ends all sessions of a user, so the next request is signed out.
 *
 * @param db The database.
 * @param userId The user id.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
async function revokeSessions(db: Db, userId: string): Promise<void> {
	await db.delete(session).where(eq(session.userId, userId));
}

export { activateInvitedUser, findUserByEmail, findUserById, insertUser, revokeSessions };
export type { UserRecord, UserStatus };
