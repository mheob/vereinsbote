import { desc, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vite-plus/test';

import { createAuth, createSessionFor } from '@/server/auth/auth';
import { getSessionUser } from '@/server/auth/session';
import type { Db } from '@/server/db/client';
import { areaMemberships, areas, auditLog, session, user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';
import { MailerNotConfiguredError } from '@/server/mail/system-mailer';
import type { SystemMailer } from '@/server/mail/system-mailer';
import { CapturingMailer } from '@/server/mail/testing';
import { ForbiddenError, loadPrincipal } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { findUserByEmail, findUserById, insertUser } from './repo';
import {
	disableUser,
	enableUser,
	inviteUser,
	LastAdminError,
	listUsersWithLevels,
	resendInvitation,
	setAdmin,
	setAreaLevel,
	UserExistsError,
} from './users';

const APP_URL = new URL('https://b.example.org');
const ONE_HOUR = 3_600_000;

/**
 * The principal of a user.
 *
 * @param db The database.
 * @param id The user id.
 * @returns The principal.
 */
async function principalOf(db: Db, id: string): Promise<Principal> {
	const found = await loadPrincipal(db, id);
	if (found === null) throw new Error('no principal');
	return found;
}

/**
 * Creates an active admin.
 *
 * @param db The database.
 * @param email The admin's address.
 * @returns The admin's principal.
 */
async function admin(db: Db, email = 'admin@v.de'): Promise<Principal> {
	const { id } = await insertUser(db, { email, isAdmin: true, name: 'Alex', status: 'active' });
	return principalOf(db, id);
}

/**
 * Creates an active user without the admin role.
 *
 * @param db The database.
 * @returns The id of Kim.
 */
async function kim(db: Db): Promise<string> {
	const { id } = await insertUser(db, { email: 'kim@v.de', name: 'Kim', status: 'active' });
	return id;
}

async function insertArea(db: Db, name: string): Promise<string> {
	const [area] = await db.insert(areas).values({ name }).returning({ id: areas.id });
	if (area === undefined) throw new Error('area not inserted');
	return area.id;
}

/**
 * The newest audit entry.
 *
 * @param db The database.
 * @returns The entry, or undefined without one.
 */
async function lastAudit(db: Db): Promise<typeof auditLog.$inferSelect | undefined> {
	const [entry] = await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
	return entry;
}

async function sessionCount(db: Db, userId: string): Promise<number> {
	const rows = await db.select().from(session).where(eq(session.userId, userId));
	return rows.length;
}

async function insertSession(db: Db, userId: string, id: string): Promise<void> {
	await db.insert(session).values({
		expiresAt: new Date(Date.now() + ONE_HOUR),
		id,
		token: `token-${id}`,
		userId,
	});
}

/**
 * Request headers that carry the cookie of a `Set-Cookie` value.
 *
 * @param setCookie The `Set-Cookie` value of the session.
 * @returns The headers.
 */
function cookieHeaders(setCookie: string): Headers {
	return new Headers({ cookie: setCookie.split(';')[0] ?? '' });
}

function deps(
	db: Db,
	mailer: Readonly<SystemMailer> = new CapturingMailer(),
): { appUrl: URL; db: Db; mailer: Readonly<SystemMailer> } {
	return { appUrl: APP_URL, db, mailer };
}

const kimInvite = { email: ' Kim@V.de', isAdmin: false, locale: 'de', name: 'Kim' } as const;

/**
 * A mailer that cannot send.
 *
 * @returns The mailer.
 */
function failingMailer(): SystemMailer {
	return {
		prepare: vi.fn<SystemMailer['prepare']>().mockRejectedValue(new MailerNotConfiguredError()),
		send: vi.fn<SystemMailer['send']>().mockRejectedValue(new MailerNotConfiguredError()),
	};
}

/**
 * What is stored about a user's invitation.
 *
 * @param db The database.
 * @param id The user id.
 * @returns When it last went out and whether that failed.
 */
async function invitationOf(
	db: Db,
	id: string,
): Promise<{ sentAt: Date | null; failed: boolean } | undefined> {
	const [row] = await db
		.select({ failed: user.invitationFailed, sentAt: user.invitationSentAt })
		.from(user)
		.where(eq(user.id, id));
	return row;
}

/**
 * Invites Kim while the mail cannot be sent; the failure is logged and silenced here.
 *
 * @param db The database.
 * @param actor The inviting admin.
 * @returns Kim's id.
 */
async function inviteWithFailingMailer(db: Db, actor: Principal): Promise<string> {
	const log = vi.spyOn(console, 'error').mockReturnValue();
	try {
		const { userId } = await inviteUser(deps(db, failingMailer()), actor, kimInvite);
		return userId;
	} finally {
		log.mockRestore();
	}
}

/**
 * Moves every invitation back in time, as if the seconds had passed (the check uses the database
 * clock).
 *
 * @param db The database.
 * @param seconds How far to move them back.
 */
async function ageInvitations(db: Db, seconds: number): Promise<void> {
	await db
		.update(user)
		.set({ invitationSentAt: sql`${user.invitationSentAt} - make_interval(secs => ${seconds})` });
}

describe(inviteUser, () => {
	it('only admins can invite', async () => {
		const db = await createTestDb();
		const id = await kim(db);
		const p = await principalOf(db, id);
		await expect(
			inviteUser(deps(db), p, { email: 'x@v.de', isAdmin: false, locale: 'de', name: 'X' }),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(findUserByEmail(db, 'x@v.de')).resolves.toBeNull();
	});

	it('normalizes the address and sends an invitation linking to /login', async () => {
		const db = await createTestDb();
		const mailer = new CapturingMailer();
		const a = await admin(db);
		await inviteUser(deps(db, mailer), a, kimInvite);
		expect(mailer.sent[0]).toMatchObject({
			content: {
				button: { label: 'Zur Anmeldung', url: 'https://b.example.org/login' },
				heading: 'Willkommen beim Vereinsbote',
				paragraphs: [
					'Hallo Kim,',
					expect.stringContaining('du wurdest zum Vereinsbote eingeladen.'),
				],
			},
			locale: 'de',
			subject: 'Einladung zum Vereinsbote',
			to: 'kim@v.de',
		});
	});

	it('stores an invited user with the trimmed name, the role and the language', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { userId } = await inviteUser(deps(db), a, {
			email: 'kim@v.de',
			isAdmin: true,
			locale: 'en',
			name: '  Kim  ',
		});
		await expect(findUserById(db, userId)).resolves.toStrictEqual({
			email: 'kim@v.de',
			id: userId,
			isAdmin: true,
			locale: 'en',
			name: 'Kim',
			status: 'invited',
		});
	});

	it('sends the invitation in the chosen language', async () => {
		const db = await createTestDb();
		const mailer = new CapturingMailer();
		const a = await admin(db);
		await inviteUser(deps(db, mailer), a, { ...kimInvite, locale: 'en' });
		expect(mailer.sent).toStrictEqual([
			{
				content: {
					button: { label: 'Go to sign-in', url: 'https://b.example.org/login' },
					heading: 'Welcome to Vereinsbote',
					paragraphs: [
						'Hello Kim,',
						'you have been invited to Vereinsbote. On the sign-in page, request a sign-in link with your e-mail address.',
					],
				},
				locale: 'en',
				subject: 'Invitation to Vereinsbote',
				to: 'kim@v.de',
			},
		]);
	});

	it('rejects inviting an existing address in other case', async () => {
		const db = await createTestDb();
		const mailer = new CapturingMailer();
		const a = await admin(db);
		await inviteUser(deps(db, mailer), a, kimInvite);
		await expect(
			inviteUser(deps(db, mailer), a, { ...kimInvite, email: 'KIM@v.de', name: 'Kim 2' }),
		).rejects.toBeInstanceOf(UserExistsError);
		await expect(db.select().from(user).where(eq(user.email, 'kim@v.de'))).resolves.toHaveLength(1);
		expect(mailer.sent).toHaveLength(1);
	});

	it('writes an audit entry without the address', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { userId } = await inviteUser(deps(db), a, kimInvite);
		const entry = await lastAudit(db);
		expect(entry).toMatchObject({
			action: 'user.invited',
			actorUserId: a.userId,
			details: { isAdmin: false, locale: 'de' },
			target: `user:${userId}`,
		});
		expect(JSON.stringify(entry)).not.toContain('@');
	});

	it('keeps the invitation when the mail cannot be sent and says so', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const result = await inviteUser(deps(db, failingMailer()), a, kimInvite);
		expect(result).toMatchObject({ mailSent: false });
		await expect(findUserById(db, result.userId)).resolves.toMatchObject({ status: 'invited' });
		expect(log).toHaveBeenCalledOnce();
		expect(JSON.stringify(log.mock.calls.flat())).not.toContain('@');
		log.mockRestore();
	});

	it('reports a sent invitation', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		await expect(inviteUser(deps(db), a, kimInvite)).resolves.toMatchObject({ mailSent: true });
	});

	it('stores when the invitation went out and that it did', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { userId } = await inviteUser(deps(db), a, kimInvite);
		const stored = await invitationOf(db, userId);
		expect(stored?.failed).toBe(false);
		expect(stored?.sentAt).toBeInstanceOf(Date);
	});
});

describe(resendInvitation, () => {
	it('remembers a failed invitation and resends it at most once a minute', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const userId = await inviteWithFailingMailer(db, a);
		await expect(invitationOf(db, userId)).resolves.toMatchObject({ failed: true });

		const mailer = new CapturingMailer();
		await expect(resendInvitation(deps(db, mailer), a, userId)).resolves.toStrictEqual({
			refused: 'tooSoon',
		});
		await ageInvitations(db, 61);
		await expect(resendInvitation(deps(db, mailer), a, userId)).resolves.toStrictEqual({
			mailSent: true,
		});
		// The minute starts again with every resend.
		await expect(resendInvitation(deps(db, mailer), a, userId)).resolves.toStrictEqual({
			refused: 'tooSoon',
		});
		expect(mailer.sent).toMatchObject([
			{
				content: { button: { url: 'https://b.example.org/login' } },
				locale: 'de',
				subject: 'Einladung zum Vereinsbote',
				to: 'kim@v.de',
			},
		]);
	});

	it('shows a failed invitation in the user list until a resend goes out, and logs the resend', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const userId = await inviteWithFailingMailer(db, a);
		await expect(listUsersWithLevels(db, a)).resolves.toContainEqual(
			expect.objectContaining({ id: userId, invitationFailed: true }),
		);
		await ageInvitations(db, 61);
		await resendInvitation(deps(db), a, userId);
		await expect(listUsersWithLevels(db, a)).resolves.toContainEqual(
			expect.objectContaining({ id: userId, invitationFailed: false }),
		);
		const entry = await lastAudit(db);
		expect(entry).toMatchObject({
			action: 'user.invitation_resent',
			actorUserId: a.userId,
			details: { mailSent: true },
			target: `user:${userId}`,
		});
		expect(JSON.stringify(entry)).not.toContain('@');
	});

	it('remembers a resend that failed again', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { userId } = await inviteUser(deps(db), a, kimInvite);
		await ageInvitations(db, 61);
		const failing = deps(db, failingMailer());
		const log = vi.spyOn(console, 'error').mockReturnValue();
		await expect(resendInvitation(failing, a, userId)).resolves.toStrictEqual({ mailSent: false });
		expect(log).toHaveBeenCalledWith('invitation not sent', 'MailerNotConfiguredError');
		log.mockRestore();
		await expect(invitationOf(db, userId)).resolves.toMatchObject({ failed: true });
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'user.invitation_resent',
			details: { mailSent: false },
		});
	});

	it('refuses to resend an invitation to an active user', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		const mailer = new CapturingMailer();
		await expect(resendInvitation(deps(db, mailer), a, id)).resolves.toStrictEqual({
			refused: 'notInvited',
		});
		await expect(resendInvitation(deps(db, mailer), a, crypto.randomUUID())).resolves.toStrictEqual(
			{ refused: 'notInvited' },
		);
		expect(mailer.sent).toStrictEqual([]);
		await expect(lastAudit(db)).resolves.toBeUndefined();
	});

	it('only admins can resend invitations', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { userId } = await inviteUser(deps(db), a, kimInvite);
		await ageInvitations(db, 61);
		const { id } = await insertUser(db, { email: 'eva@v.de', name: 'Eva', status: 'active' });
		const p = await principalOf(db, id);
		const mailer = new CapturingMailer();
		await expect(resendInvitation(deps(db, mailer), p, userId)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		expect(mailer.sent).toStrictEqual([]);
	});
});

describe('the last admin', () => {
	it('refuses to disable or demote the last active admin', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		await expect(disableUser(db, a, a.userId)).rejects.toBeInstanceOf(LastAdminError);
		await expect(setAdmin(db, a, a.userId, false)).rejects.toBeInstanceOf(LastAdminError);
		await expect(findUserById(db, a.userId)).resolves.toMatchObject({
			isAdmin: true,
			status: 'active',
		});
	});

	it('does not count disabled admins', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		await insertUser(db, { email: 'b@v.de', isAdmin: true, name: 'B', status: 'disabled' });
		await expect(setAdmin(db, a, a.userId, false)).rejects.toBeInstanceOf(LastAdminError);
		await expect(disableUser(db, a, a.userId)).rejects.toBeInstanceOf(LastAdminError);
	});

	it('does not count invited admins', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		await insertUser(db, { email: 'b@v.de', isAdmin: true, name: 'B', status: 'invited' });
		await expect(setAdmin(db, a, a.userId, false)).rejects.toBeInstanceOf(LastAdminError);
		await expect(disableUser(db, a, a.userId)).rejects.toBeInstanceOf(LastAdminError);
		await expect(findUserById(db, a.userId)).resolves.toMatchObject({
			isAdmin: true,
			status: 'active',
		});
	});

	it('lets the only active admin demote and disable an invited admin', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { id } = await insertUser(db, {
			email: 'b@v.de',
			isAdmin: true,
			name: 'B',
			status: 'invited',
		});
		await setAdmin(db, a, id, false);
		await disableUser(db, a, id);
		await expect(findUserById(db, id)).resolves.toMatchObject({
			isAdmin: false,
			status: 'disabled',
		});
	});

	it('allows demoting an admin when another active admin exists', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const b = await admin(db, 'b@v.de');
		await setAdmin(db, a, b.userId, false);
		await expect(findUserById(db, b.userId)).resolves.toMatchObject({ isAdmin: false });
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'user.admin_changed',
			actorUserId: a.userId,
			details: { from: true, to: false },
			target: `user:${b.userId}`,
		});
	});

	it('allows disabling an admin when another active admin exists', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const b = await admin(db, 'b@v.de');
		await disableUser(db, b, a.userId);
		await expect(findUserById(db, a.userId)).resolves.toMatchObject({ status: 'disabled' });
	});

	it('keeps one admin when two admins demote each other at the same time', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const b = await admin(db, 'b@v.de');
		const results = await Promise.allSettled([
			setAdmin(db, a, b.userId, false),
			setAdmin(db, b, a.userId, false),
		]);
		expect(results.map((result) => result.status).toSorted()).toStrictEqual([
			'fulfilled',
			'rejected',
		]);
		await expect(db.select().from(user).where(eq(user.isAdmin, true))).resolves.toHaveLength(1);
	});
});

describe(setAdmin, () => {
	it('makes a user an admin and writes an audit entry', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		await setAdmin(db, a, id, true);
		await expect(findUserById(db, id)).resolves.toMatchObject({ isAdmin: true });
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'user.admin_changed',
			details: { from: false, to: true },
			target: `user:${id}`,
		});
	});

	it('writes no audit entry when the role stays the same', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		await setAdmin(db, a, id, false);
		await expect(db.select().from(auditLog)).resolves.toHaveLength(0);
	});

	it('only admins can change the role', async () => {
		const db = await createTestDb();
		const id = await kim(db);
		const p = await principalOf(db, id);
		await expect(setAdmin(db, p, id, true)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(findUserById(db, id)).resolves.toMatchObject({ isAdmin: false });
	});
});

describe(disableUser, () => {
	it('disabling a user revokes all sessions', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		await insertSession(db, id, 'kim-1');
		await insertSession(db, id, 'kim-2');
		await insertSession(db, a.userId, 'admin-1');
		await disableUser(db, a, id);
		await expect(findUserById(db, id)).resolves.toMatchObject({ status: 'disabled' });
		await expect(sessionCount(db, id)).resolves.toBe(0);
		await expect(sessionCount(db, a.userId)).resolves.toBe(1);
	});

	it('signs a disabled user out on the next request', async () => {
		const db = await createTestDb();
		const env = parseEnv({
			APP_SECRET: Buffer.alloc(32, 3).toString('base64'),
			APP_URL: APP_URL.href,
			CRON_SECRET: 'c'.repeat(32),
			DATABASE_URL: 'postgres://x@localhost/x',
		});
		const auth = await createAuth({ db, env, mailer: new CapturingMailer() });
		const a = await admin(db);
		const id = await kim(db);
		const { setCookie } = await createSessionFor(auth, id);
		const headers = cookieHeaders(setCookie);
		await expect(getSessionUser(auth, db, headers)).resolves.toMatchObject({ id });
		await disableUser(db, a, id);
		await expect(auth.api.getSession({ headers })).resolves.toBeNull();
		await expect(getSessionUser(auth, db, headers)).resolves.toBeNull();
	});

	it('writes an audit entry', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		await disableUser(db, a, id);
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'user.disabled',
			actorUserId: a.userId,
			target: `user:${id}`,
		});
	});

	it('only admins can disable users', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		const p = await principalOf(db, id);
		await expect(disableUser(db, p, a.userId)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(findUserById(db, a.userId)).resolves.toMatchObject({ status: 'active' });
	});
});

/**
 * Opens a session for a user, the way a sign-in does (the session hooks apply).
 *
 * @param db The database.
 * @param id The user id.
 */
async function signInOnce(db: Db, id: string): Promise<void> {
	const env = parseEnv({
		APP_SECRET: Buffer.alloc(32, 3).toString('base64'),
		APP_URL: APP_URL.href,
		CRON_SECRET: 'c'.repeat(32),
		DATABASE_URL: 'postgres://x@localhost/x',
	});
	const auth = await createAuth({ db, env, mailer: new CapturingMailer() });
	await createSessionFor(auth, id);
}

describe(enableUser, () => {
	it('enables a user who has signed in before as active and writes an audit entry', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { id } = await insertUser(db, { email: 'kim@v.de', name: 'Kim' });
		await signInOnce(db, id);
		await disableUser(db, a, id);
		await enableUser(db, a, id);
		await expect(findUserById(db, id)).resolves.toMatchObject({ status: 'active' });
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'user.enabled',
			actorUserId: a.userId,
			details: { to: 'active' },
			target: `user:${id}`,
		});
	});

	it('enables a user who never signed in as invited', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { id } = await insertUser(db, { email: 'kim@v.de', name: 'Kim' });
		await disableUser(db, a, id);
		await enableUser(db, a, id);
		await expect(findUserById(db, id)).resolves.toMatchObject({ status: 'invited' });
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'user.enabled',
			details: { to: 'invited' },
		});
	});

	it('changes nothing for a user who is not disabled', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		await enableUser(db, a, id);
		await expect(findUserById(db, id)).resolves.toMatchObject({ status: 'active' });
		await expect(db.select().from(auditLog)).resolves.toHaveLength(0);
	});

	it('only admins can enable users', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		await disableUser(db, a, id);
		const { id: otherId } = await insertUser(db, { email: 'o@v.de', name: 'O', status: 'active' });
		const other = await principalOf(db, otherId);
		await expect(enableUser(db, other, id)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(findUserById(db, id)).resolves.toMatchObject({ status: 'disabled' });
	});
});

describe(setAreaLevel, () => {
	it('setAreaLevel null removes access and writes an audit entry', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		const areaId = await insertArea(db, 'Finanzen');
		await setAreaLevel(db, a, { areaId, level: 'read', userId: id });
		await setAreaLevel(db, a, { areaId, level: null, userId: id });
		const kimNow = await principalOf(db, id);
		expect(kimNow.areas.has(areaId)).toBe(false);
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'user.area_level_changed',
			actorUserId: a.userId,
			details: { areaId, from: 'read', to: null },
			target: `user:${id}`,
		});
	});

	it('grants and changes a level, with an audit entry each time', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		const areaId = await insertArea(db, 'Finanzen');
		await setAreaLevel(db, a, { areaId, level: 'read', userId: id });
		await setAreaLevel(db, a, { areaId, level: 'send', userId: id });
		const kimNow = await principalOf(db, id);
		expect(kimNow.areas.get(areaId)).toBe('send');
		const entries = await db.select().from(auditLog).orderBy(auditLog.id);
		expect(entries.map((entry) => entry.details)).toStrictEqual([
			{ areaId, from: null, to: 'read' },
			{ areaId, from: 'read', to: 'send' },
		]);
	});

	it('writes no audit entry when the level stays the same', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		const areaId = await insertArea(db, 'Finanzen');
		await setAreaLevel(db, a, { areaId, level: null, userId: id });
		await setAreaLevel(db, a, { areaId, level: 'edit', userId: id });
		await setAreaLevel(db, a, { areaId, level: 'edit', userId: id });
		await expect(db.select().from(auditLog)).resolves.toHaveLength(1);
	});

	it('only admins can set levels', async () => {
		const db = await createTestDb();
		const id = await kim(db);
		const areaId = await insertArea(db, 'Finanzen');
		const p = await principalOf(db, id);
		await expect(setAreaLevel(db, p, { areaId, level: 'send', userId: id })).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(db.select().from(areaMemberships)).resolves.toHaveLength(0);
	});
});

describe(listUsersWithLevels, () => {
	it('lists every user with the level per area, sorted by name', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		const finance = await insertArea(db, 'Finanzen');
		const members = await insertArea(db, 'Mitglieder');
		await setAreaLevel(db, a, { areaId: finance, level: 'read', userId: id });
		await setAreaLevel(db, a, { areaId: members, level: 'send', userId: id });
		await expect(listUsersWithLevels(db, a)).resolves.toStrictEqual([
			{
				email: 'admin@v.de',
				id: a.userId,
				invitationFailed: false,
				isAdmin: true,
				levels: {},
				name: 'Alex',
				status: 'active',
			},
			{
				email: 'kim@v.de',
				id,
				invitationFailed: false,
				isAdmin: false,
				levels: { [finance]: 'read', [members]: 'send' },
				name: 'Kim',
				status: 'active',
			},
		]);
	});

	it('only admins can list users', async () => {
		const db = await createTestDb();
		const p = await principalOf(db, await kim(db));
		await expect(listUsersWithLevels(db, p)).rejects.toBeInstanceOf(ForbiddenError);
	});
});
