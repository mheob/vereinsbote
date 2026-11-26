/* oxlint-disable max-classes-per-file -- the plan's interface defines both user errors in this module */
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { LOGIN_PATH } from '@/paths';
import { writeAudit } from '@/server/audit/audit';
import { normalizeEmail } from '@/server/auth/email';
import type { Db } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { areaMemberships, user } from '@/server/db/schema';
import { errorLabel } from '@/server/error-label';
import type { SystemMailer } from '@/server/mail/system-mailer';
import type { AccessLevel } from '@/server/permissions/levels';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { insertUser, revokeSessions } from './repo';
import type { UserStatus } from './repo';

/** A user with this address exists already, in any spelling. The message names no address. */
class UserExistsError extends Error {
	public constructor() {
		super('A user with this address already exists.');
		this.name = 'UserExistsError';
	}
}

/** The change would leave no active admin. */
class LastAdminError extends Error {
	public constructor() {
		super('The last active admin cannot be disabled or lose the admin role.');
		this.name = 'LastAdminError';
	}
}

/** A resend waits this long after the last invitation mail of the user. */
const INVITATION_RESEND_SECONDS = 60;

interface UserRow {
	readonly id: string;
	readonly email: string;
	readonly name: string;
	readonly isAdmin: boolean;
	readonly status: UserStatus;
	/** The last invitation mail could not be sent. */
	readonly invitationFailed: boolean;
	/** The level per area id; areas without an entry are not accessible. */
	readonly levels: Readonly<Record<string, AccessLevel>>;
}

interface InviteDeps {
	readonly db: Db;
	readonly mailer: Readonly<SystemMailer>;
	/** `APP_URL`; the invitation links to its sign-in page. */
	readonly appUrl: URL;
}

/** Why an invitation was not sent again: the user is no longer invited, or was just mailed. */
type ResendRefusal = 'notInvited' | 'tooSoon';

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
	// oxlint-disable-next-line no-console -- the only trace of an invitation that never arrives
	console.error('invitation not sent', errorLabel(error));
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
			content: {
				button: { label: translate(locale, 'mail.system.invite.button'), url: link },
				heading: translate(locale, 'mail.system.invite.heading'),
				paragraphs: [
					translate(locale, 'mail.system.greeting', { name }),
					translate(locale, 'mail.system.invite.text'),
				],
			},
			locale,
			subject: translate(locale, 'mail.system.invite.subject'),
			to,
		});
		return true;
	} catch (error) {
		logInviteFailure(error);
		return false;
	}
}

/**
 * Locks every active admin, so concurrent changes of admins wait for each other and see each
 * other's result: two admins who demote each other cannot both succeed. Invited admins do not
 * count: they may never be able to sign in (no mail transport), so they could not take over. The
 * rows are locked in id order, so two transactions never wait for each other in a cycle.
 *
 * @param tx The transaction.
 * @returns The ids of the active admins.
 */
async function lockActiveAdmins(tx: Db): Promise<string[]> {
	const rows = await tx
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.isAdmin, true), eq(user.status, 'active')))
		.orderBy(user.id)
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
 * Tells whether an active admin remains once a user loses the role or is disabled.
 *
 * @param activeAdmins The ids of all active admins.
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
 * Stores how the invitation mail of a user went.
 *
 * @param db The database.
 * @param userId The user.
 * @param mail Whether it went out, and whether its time is stored already (a resend claims it).
 * @param mail.mailSent True when the mail went out.
 * @param mail.stampSentAt True to store now as the time of the mail.
 */
async function recordInvitation(
	db: Db,
	userId: string,
	{ mailSent, stampSentAt }: Readonly<{ mailSent: boolean; stampSentAt: boolean }>,
): Promise<void> {
	await db
		.update(user)
		.set({
			invitationFailed: !mailSent,
			...(stampSentAt ? { invitationSentAt: sql`now()` } : {}),
		})
		.where(eq(user.id, userId));
}

/**
 * Invites a user: creates the user (status `invited`, the given role and language) and sends an
 * invitation in that language that links to the sign-in page. The user stays invited when the mail
 * cannot be sent; they can still request a login link or use Microsoft, and the result says so.
 * The time of the mail and whether it failed are stored, for the user list and for a resend.
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
	await recordInvitation(deps.db, userId, { mailSent, stampSentAt: true });
	return { mailSent, userId };
}

/**
 * The condition of a user whose last invitation mail is old enough for a resend: none yet, or at
 * least `INVITATION_RESEND_SECONDS` ago (database clock).
 *
 * @returns The condition on `user`.
 */
function isResendDue(): SQL | undefined {
	const waited = sql`now() - make_interval(secs => ${INVITATION_RESEND_SECONDS})`;
	return or(isNull(user.invitationSentAt), lte(user.invitationSentAt, waited));
}

/**
 * Claims the resend of an invitation: stores now as the time of the mail, but only for an invited
 * user whose last invitation mail is at least `INVITATION_RESEND_SECONDS` old (database clock).
 * One statement, so two admins who press at once send one mail.
 *
 * @param db The database.
 * @param userId The user.
 * @returns The address, the name and the language of the user, or null when not claimed.
 */
async function claimInvitationResend(
	db: Db,
	userId: string,
): Promise<{ email: string; name: string; locale: Locale } | null> {
	const [claimed] = await db
		.update(user)
		.set({ invitationSentAt: sql`now()` })
		.where(and(eq(user.id, userId), eq(user.status, 'invited'), isResendDue()))
		.returning({ email: user.email, locale: user.locale, name: user.name });
	return claimed ?? null;
}

/**
 * Tells why an invitation could not be claimed for a resend.
 *
 * @param db The database.
 * @param userId The user.
 * @returns `tooSoon` for an invited user, `notInvited` for any other or an unknown user.
 */
async function resendRefusal(db: Db, userId: string): Promise<ResendRefusal> {
	const [found] = await db.select({ status: user.status }).from(user).where(eq(user.id, userId));
	return found?.status === 'invited' ? 'tooSoon' : 'notInvited';
}

/**
 * Sends the invitation of an invited user again, at most once a minute per user (counted from the
 * last invitation mail, sent or failed). The result and the activity log say whether it went out;
 * the user list shows a failed one.
 *
 * @param deps The database, the mailer and `APP_URL`.
 * @param actor Who resends; must be an admin.
 * @param userId The user.
 * @returns Whether the mail went out, or why it was not sent again.
 * @throws {ForbiddenError} When the actor is no admin.
 */
async function resendInvitation(
	deps: InviteDeps,
	actor: Principal,
	userId: string,
): Promise<{ mailSent: boolean } | { refused: ResendRefusal }> {
	assertAdmin(actor);
	const claimed = await claimInvitationResend(deps.db, userId);
	if (claimed === null) return { refused: await resendRefusal(deps.db, userId) };
	const mailSent = await sendInvitation(deps.mailer, {
		appUrl: deps.appUrl,
		locale: claimed.locale,
		name: claimed.name,
		to: claimed.email,
	});
	await deps.db.transaction(async (tx) => {
		await recordInvitation(tx, userId, { mailSent, stampSentAt: false });
		await writeAudit(tx, {
			action: 'user.invitation_resent',
			actorUserId: actor.userId,
			details: { mailSent },
			target: `user:${userId}`,
		});
	});
	return { mailSent };
}

/**
 * Gives or takes the admin role. The last active admin keeps it.
 *
 * @param db The database.
 * @param actor Who changes the role; must be an admin.
 * @param userId The user.
 * @param isAdmin The new role.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {LastAdminError} When no other active admin would remain.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function setAdmin(db: Db, actor: Principal, userId: string, isAdmin: boolean): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		const activeAdmins = await lockActiveAdmins(tx);
		const target = await lockUser(tx, userId);
		if (target.isAdmin === isAdmin) return;
		if (!isAdmin && target.status === 'active' && !anotherActiveAdmin(activeAdmins, userId)) {
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
 * last active admin cannot be disabled.
 *
 * @param db The database.
 * @param actor Who disables; must be an admin.
 * @param userId The user.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {LastAdminError} When no other active admin would remain.
 */
async function disableUser(db: Db, actor: Principal, userId: string): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		const activeAdmins = await lockActiveAdmins(tx);
		const target = await lockUser(tx, userId);
		if (target.status === 'disabled') return;
		if (target.isAdmin && target.status === 'active' && !anotherActiveAdmin(activeAdmins, userId)) {
			throw new LastAdminError();
		}
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
 * Enables a disabled user again: `active` when the user has signed in before, `invited`
 * otherwise, so an admin who never signed in does not count as an active admin. The user signs in
 * anew; the sessions ended with the block stay ended. A user who is not disabled stays as is.
 *
 * @param db The database.
 * @param actor Who enables; must be an admin.
 * @param userId The user.
 * @throws {ForbiddenError} When the actor is no admin.
 */
async function enableUser(db: Db, actor: Principal, userId: string): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		const [target] = await tx
			.select({ firstSignInAt: user.firstSignInAt, status: user.status })
			.from(user)
			.where(eq(user.id, userId))
			.for('update');
		if (target === undefined) throw new Error('The user does not exist.');
		if (target.status !== 'disabled') return;
		const status = target.firstSignInAt === null ? 'invited' : 'active';
		await tx.update(user).set({ status }).where(eq(user.id, userId));
		await writeAudit(tx, {
			action: 'user.enabled',
			actorUserId: actor.userId,
			details: { to: status },
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
				invitationFailed: user.invitationFailed,
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
	return users.map(({ email, id, invitationFailed, isAdmin, name, status }) => ({
		email,
		id,
		invitationFailed,
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
	enableUser,
	inviteUser,
	listUsersWithLevels,
	resendInvitation,
	setAdmin,
	setAreaLevel,
};
export type { ResendRefusal, UserRow };
