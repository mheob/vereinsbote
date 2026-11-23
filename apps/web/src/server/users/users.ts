/* oxlint-disable max-classes-per-file -- the plan's interface defines both user errors in this module */
import { and, eq, ne, sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { writeAudit } from '@/server/audit/audit';
import { normalizeEmail } from '@/server/auth/email';
import type { Db } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { areaMemberships, user } from '@/server/db/schema';
import type { SystemMailer } from '@/server/mail/system-mailer';
import type { AccessLevel } from '@/server/permissions/levels';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { insertUser, revokeSessions } from './repo';
import type { UserStatus } from './repo';

/** Where the invitation leads: the sign-in page, where the user requests a login link. */
const LOGIN_PATH = '/login';

/** A user with this address exists already, in any spelling. The message names no address. */
class UserExistsError extends Error {
	public constructor() {
		super('A user with this address already exists.');
		this.name = 'UserExistsError';
	}
}

/** The change would leave no admin who is not disabled. */
class LastAdminError extends Error {
	public constructor() {
		super('The last admin cannot be disabled or lose the admin role.');
		this.name = 'LastAdminError';
	}
}

interface UserRow {
	readonly id: string;
	readonly email: string;
	readonly name: string;
	readonly isAdmin: boolean;
	readonly status: UserStatus;
	/** The level per area id; areas without an entry are not accessible. */
	readonly levels: Readonly<Record<string, AccessLevel>>;
}

interface InviteDeps {
	readonly db: Db;
	readonly mailer: Readonly<SystemMailer>;
	/** `APP_URL`; the invitation links to its sign-in page. */
	readonly appUrl: URL;
}

interface InviteInput {
	/** The address as typed; it is stored normalized. */
	email: string;
	/** The name; it is stored trimmed. */
	name: string;
	isAdmin: boolean;
	/** The language of the invitation and of the user's later system mails. */
	locale: Locale;
}

/**
 * Logs that an invitation could not be sent. Code or name only: the message of a transport error
 * may carry connection details.
 *
 * @param error The error of the mailer.
 */
function logInviteFailure(error: unknown): void {
	const label =
		error instanceof Error
			? (('code' in error ? String(error.code) : undefined) ?? error.name)
			: 'unknown';
	// oxlint-disable-next-line no-console -- the only trace of an invitation that never arrives
	console.error('invitation not sent', label);
}

/**
 * Sends the invitation in the invited user's language.
 *
 * @param mailer The mailer.
 * @param mail The invitation.
 * @param mail.to The normalized address.
 * @param mail.name The invited user's name.
 * @param mail.locale The invited user's language.
 * @param mail.appUrl `APP_URL`.
 * @returns True when the mail went out.
 */
async function sendInvitation(
	mailer: Readonly<SystemMailer>,
	{ to, name, locale, appUrl }: Readonly<{ to: string; name: string; locale: Locale; appUrl: URL }>,
): Promise<boolean> {
	const link = new URL(LOGIN_PATH, appUrl).href;
	try {
		await mailer.send({
			subject: translate(locale, 'mail.invite.subject'),
			text: translate(locale, 'mail.invite.text', { link, name }),
			to,
		});
		return true;
	} catch (error) {
		logInviteFailure(error);
		return false;
	}
}

/**
 * Locks every admin who is not disabled, so concurrent changes of admins wait for each other and
 * see each other's result: two admins who demote each other cannot both succeed.
 *
 * @param tx The transaction.
 * @returns The ids of those admins.
 */
async function lockActiveAdmins(tx: Db): Promise<string[]> {
	const rows = await tx
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.isAdmin, true), ne(user.status, 'disabled')))
		.for('update');
	return rows.map((row) => row.id);
}

/**
 * Locks a user for a change.
 *
 * @param tx The transaction.
 * @param userId The user id.
 * @returns The user's role and status.
 * @throws {Error} When there is no such user.
 */
async function lockUser(tx: Db, userId: string): Promise<{ isAdmin: boolean; status: UserStatus }> {
	const [found] = await tx
		.select({ isAdmin: user.isAdmin, status: user.status })
		.from(user)
		.where(eq(user.id, userId))
		.for('update');
	if (found === undefined) throw new Error('The user does not exist.');
	return found;
}

/**
 * Tells whether an admin who is not disabled remains once a user loses the role or is disabled.
 *
 * @param activeAdmins The ids of all admins who are not disabled.
 * @param userId The user who loses the role or is disabled.
 * @returns True when another one remains.
 */
function anotherActiveAdmin(activeAdmins: readonly string[], userId: string): boolean {
	return activeAdmins.some((id) => id !== userId);
}

/**
 * Creates the invited user and its audit entry.
 *
 * @param db The database.
 * @param actor The inviting admin.
 * @param input The invitation form.
 * @returns The id of the new user.
 * @throws {UserExistsError} When the address is taken, in any spelling.
 */
async function createInvitedUser(
	db: Db,
	actor: Principal,
	input: Readonly<InviteInput>,
): Promise<string> {
	try {
		return await db.transaction(async (tx) => {
			const { id } = await insertUser(tx, {
				email: input.email,
				isAdmin: input.isAdmin,
				locale: input.locale,
				name: input.name.trim(),
				status: 'invited',
			});
			await writeAudit(tx, {
				action: 'user.invited',
				actorUserId: actor.userId,
				details: { isAdmin: input.isAdmin, locale: input.locale },
				target: `user:${id}`,
			});
			return id;
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new UserExistsError();
		throw error;
	}
}

/**
 * Invites a user: creates the user (status `invited`, the given role and language) and sends an
 * invitation in that language that links to the sign-in page. The user stays invited when the mail
 * cannot be sent; they can still request a login link or use Microsoft, and the result says so.
 *
 * @param deps The database, the mailer and `APP_URL`.
 * @param actor Who invites; must be an admin.
 * @param input The invitation form.
 * @returns The id of the new user and whether the invitation went out.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {UserExistsError} When the address is taken, in any spelling.
 */
async function inviteUser(
	deps: InviteDeps,
	actor: Principal,
	input: Readonly<InviteInput>,
): Promise<{ userId: string; mailSent: boolean }> {
	assertAdmin(actor);
	const userId = await createInvitedUser(deps.db, actor, input);
	const mailSent = await sendInvitation(deps.mailer, {
		appUrl: deps.appUrl,
		locale: input.locale,
		name: input.name.trim(),
		to: normalizeEmail(input.email),
	});
	return { mailSent, userId };
}

/**
 * Gives or takes the admin role. The last admin who is not disabled keeps it.
 *
 * @param db The database.
 * @param actor Who changes the role; must be an admin.
 * @param userId The user.
 * @param isAdmin The new role.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {LastAdminError} When no other admin who is not disabled would remain.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function setAdmin(db: Db, actor: Principal, userId: string, isAdmin: boolean): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		const activeAdmins = await lockActiveAdmins(tx);
		const target = await lockUser(tx, userId);
		if (target.isAdmin === isAdmin) return;
		if (!isAdmin && target.status !== 'disabled' && !anotherActiveAdmin(activeAdmins, userId)) {
			throw new LastAdminError();
		}
		await tx.update(user).set({ isAdmin }).where(eq(user.id, userId));
		await writeAudit(tx, {
			action: 'user.admin_changed',
			actorUserId: actor.userId,
			details: { from: target.isAdmin, to: isAdmin },
			target: `user:${userId}`,
		});
	});
}

/**
 * Disables a user and ends all of the user's sessions, so the next request is signed out. The
 * last admin who is not disabled cannot be disabled.
 *
 * @param db The database.
 * @param actor Who disables; must be an admin.
 * @param userId The user.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {LastAdminError} When no other admin who is not disabled would remain.
 */
async function disableUser(db: Db, actor: Principal, userId: string): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		const activeAdmins = await lockActiveAdmins(tx);
		const target = await lockUser(tx, userId);
		if (target.status === 'disabled') return;
		if (target.isAdmin && !anotherActiveAdmin(activeAdmins, userId)) throw new LastAdminError();
		await tx.update(user).set({ status: 'disabled' }).where(eq(user.id, userId));
		await revokeSessions(tx, userId);
		await writeAudit(tx, {
			action: 'user.disabled',
			actorUserId: actor.userId,
			target: `user:${userId}`,
		});
	});
}

/**
 * Sets a user's level in an area; null removes the access.
 *
 * @param db The database.
 * @param actor Who changes the level; must be an admin.
 * @param input The user, the area and the new level.
 * @throws {ForbiddenError} When the actor is no admin.
 */
async function setAreaLevel(
	db: Db,
	actor: Principal,
	input: Readonly<{ userId: string; areaId: string; level: AccessLevel | null }>,
): Promise<void> {
	assertAdmin(actor);
	const { areaId, level, userId } = input;
	const membership = and(eq(areaMemberships.userId, userId), eq(areaMemberships.areaId, areaId));
	await db.transaction(async (tx) => {
		const [current] = await tx
			.select({ level: areaMemberships.level })
			.from(areaMemberships)
			.where(membership)
			.for('update');
		const from = current?.level ?? null;
		if (from === level) return;
		await (level === null
			? tx.delete(areaMemberships).where(membership)
			: tx
					.insert(areaMemberships)
					.values({ areaId, level, userId })
					.onConflictDoUpdate({
						set: { level },
						target: [areaMemberships.userId, areaMemberships.areaId],
					}));
		await writeAudit(tx, {
			action: 'user.area_level_changed',
			actorUserId: actor.userId,
			details: { areaId, from, to: level },
			target: `user:${userId}`,
		});
	});
}

/**
 * Lists all users by name, each with the level per area.
 *
 * @param db The database.
 * @param actor Who asks; must be an admin.
 * @returns The users.
 * @throws {ForbiddenError} When the actor is no admin.
 */
async function listUsersWithLevels(db: Db, actor: Principal): Promise<UserRow[]> {
	assertAdmin(actor);
	const [users, memberships] = await Promise.all([
		db
			.select({
				email: user.email,
				id: user.id,
				isAdmin: user.isAdmin,
				name: user.name,
				status: user.status,
			})
			.from(user)
			.orderBy(sql`lower(${user.name})`, user.email),
		db
			.select({
				areaId: areaMemberships.areaId,
				level: areaMemberships.level,
				userId: areaMemberships.userId,
			})
			.from(areaMemberships),
	]);
	const levels = new Map<string, Readonly<Record<string, AccessLevel>>>();
	for (const { areaId, level, userId } of memberships) {
		levels.set(userId, { ...levels.get(userId), [areaId]: level });
	}
	return users.map(({ email, id, isAdmin, name, status }) => ({
		email,
		id,
		isAdmin,
		levels: levels.get(id) ?? {},
		name,
		status,
	}));
}

export {
	LastAdminError,
	UserExistsError,
	disableUser,
	inviteUser,
	listUsersWithLevels,
	setAdmin,
	setAreaLevel,
};
export type { UserRow };
