import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { DEFAULT_LOCALE } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';
import { normalizeEmail } from '@/server/auth/email';
import type { Db } from '@/server/db/client';
import { session, user } from '@/server/db/schema';
import type { userStatuses } from '@/server/db/schema';

type UserStatus = (typeof userStatuses)[number];

interface UserRecord {
	id: string;
	email: string;
	name: string;
	isAdmin: boolean;
	status: UserStatus;
	/** The language of the user's system mails. */
	locale: Locale;
}

const userRecord = {
	email: user.email,
	id: user.id,
	isAdmin: user.isAdmin,
	locale: user.locale,
	name: user.name,
	status: user.status,
};

/**
 * Creates a user. The address is stored normalized; a second user with the same address fails
 * on the unique index on `lower(email)`.
 *
 * @param db The database.
 * @param input The user's address and name; `isAdmin` defaults to false, `status` to `invited`,
 *   `locale` to `de`.
 * @returns The id of the new user.
 */
async function insertUser(
	db: Db,
	input: Readonly<{
		email: string;
		name: string;
		isAdmin?: boolean;
		status?: UserStatus;
		locale?: Locale;
		/** True stores now (database clock) as the time of the user's invitation mail. */
		invitationSent?: boolean;
	}>,
): Promise<{ id: string }> {
	const [row] = await db
		.insert(user)
		.values({
			email: normalizeEmail(input.email),
			isAdmin: input.isAdmin ?? false,
			locale: input.locale ?? DEFAULT_LOCALE,
			name: input.name,
			status: input.status ?? 'invited',
			...(input.invitationSent === true ? { invitationSentAt: sql`now()` } : {}),
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
	db: Db,
	email: string,
): Promise<{ id: string; status: UserStatus; isAdmin: boolean; locale: Locale } | null> {
	const [row] = await db
		.select({ id: user.id, isAdmin: user.isAdmin, locale: user.locale, status: user.status })
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
async function findUserById(db: Db, id: string): Promise<UserRecord | null> {
	const [row] = await db.select(userRecord).from(user).where(eq(user.id, id));
	return row ?? null;
}

/**
 * Records a sign-in: an invited user becomes active, and the time of the user's first sign-in is
 * kept (`firstSignInAt`). Later sign-ins and other statuses change nothing.
 *
 * @param db The database.
 * @param id The user id.
 */
async function recordSignIn(db: Db, id: string): Promise<void> {
	const firstOrInvited = or(eq(user.status, 'invited'), isNull(user.firstSignInAt));
	await db
		.update(user)
		.set({
			firstSignInAt: sql`coalesce(${user.firstSignInAt}, now())`,
			status: sql`case when ${user.status} = 'invited' then 'active' else ${user.status} end`,
		})
		.where(and(eq(user.id, id), firstOrInvited));
}

/**
 * Stores the language of a user, used for the user's system mails.
 *
 * @param db The database.
 * @param id The user id.
 * @param locale The language.
 */
async function setUserLocale(db: Db, id: string, locale: Locale): Promise<void> {
	await db.update(user).set({ locale }).where(eq(user.id, id));
}

/**
 * Ends all sessions of a user, so the next request is signed out.
 *
 * @param db The database.
 * @param userId The user id.
 */
async function revokeSessions(db: Db, userId: string): Promise<void> {
	await db.delete(session).where(eq(session.userId, userId));
}

export { findUserByEmail, findUserById, insertUser, recordSignIn, revokeSessions, setUserLocale };
export type { UserRecord, UserStatus };
