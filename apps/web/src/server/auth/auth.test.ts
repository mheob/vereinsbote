import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { t } from '../../i18n/t';
import type { Db } from '../db/client';
import { session, user } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { parseEnv } from '../env';
import { MailerNotConfiguredError } from '../mail/system-mailer';
import type { SystemMail, SystemMailer } from '../mail/system-mailer';
import { CapturingMailer } from '../mail/testing';
import { findUserByEmail, insertUser, revokeSessions } from '../users/repo';
import { createAuth, LoginLinkInvalidError, requestLoginLink, verifyLoginLink } from './auth';
import type { Auth } from './auth';
import { getSessionUser } from './session';

const FIFTEEN_MINUTES = 15 * 60_000;
const APP_URL = 'https://bote.example.org';

const baseEnv = {
	APP_SECRET: Buffer.alloc(32, 3).toString('base64'),
	APP_URL,
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://x@localhost/x',
};

interface Setup {
	auth: Auth;
	db: Db;
	mailer: CapturingMailer;
}

async function setup(
	extraEnv: Readonly<Record<string, string>> = {},
	mailer: Readonly<SystemMailer> = new CapturingMailer(),
): Promise<Omit<Setup, 'mailer'>> {
	const db = await createTestDb();
	const env = parseEnv({ ...baseEnv, ...extraEnv });
	const auth = await createAuth({ db, env, mailer });
	return { auth, db };
}

async function setupCapturing(extraEnv: Readonly<Record<string, string>> = {}): Promise<Setup> {
	const mailer = new CapturingMailer();
	return { ...(await setup(extraEnv, mailer)), mailer };
}

function tokenFrom(text: string): string {
	const token = /token=(?<token>[^&\s]+)/u.exec(text)?.groups?.token;
	if (token === undefined) throw new Error('The mail contains no token.');
	return token;
}

/**
 * Reads the token of the login link in the last mail.
 *
 * @param sent The mails sent so far.
 * @returns The token.
 */
function lastToken(sent: readonly Readonly<SystemMail>[]): string {
	const mail = sent.at(-1);
	if (mail === undefined) throw new Error('No mail was sent.');
	return tokenFrom(mail.text);
}

const cookieHeaders = (setCookie: string): Headers =>
	new Headers({ cookie: setCookie.split(';')[0] ?? '' });

/**
 * Invites a user, requests a link and verifies it.
 *
 * @param context The test setup.
 * @param context.auth The auth instance.
 * @param context.db The database.
 * @param context.mailer The capturing mailer.
 * @param input The address and the admin flag of the user.
 * @returns The user id and request headers carrying the session cookie.
 */
async function signIn(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle and Better Auth instances are mutable
	{ auth, db, mailer }: Readonly<Setup>,
	input: Readonly<{ email: string; isAdmin?: boolean }>,
): Promise<{ headers: Headers; id: string }> {
	const { id } = await insertUser(db, { ...input, name: 'Anna' });
	await requestLoginLink(auth, input.email);
	const { setCookie } = await verifyLoginLink(auth, lastToken(mailer.sent));
	return { headers: cookieHeaders(setCookie), id };
}

describe('passwordless sign-in', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe(requestLoginLink, () => {
		it('sends a link to an invited user regardless of case and spaces', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, ' Anna@Verein.DE');
			expect(mailer.sent).toHaveLength(1);
			expect(mailer.sent[0]).toMatchObject({
				subject: t('mail.login.subject'),
				to: 'anna@verein.de',
			});
			expect(mailer.sent[0]?.text).toContain(`${APP_URL}/`);
			expect(mailer.sent[0]?.text).toContain(
				'Der Link ist 15 Minuten gültig und funktioniert einmal.',
			);
		});

		it('sends a link to an active user', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna', status: 'active' });
			await requestLoginLink(auth, 'anna@verein.de');
			expect(mailer.sent).toHaveLength(1);
			expect(mailer.sent[0]).toMatchObject({ to: 'anna@verein.de' });
		});

		it('sends nothing to unknown addresses', async () => {
			const { mailer, auth } = await setupCapturing();
			await expect(requestLoginLink(auth, 'fremd@example.org')).resolves.toBeUndefined();
			expect(mailer.sent).toHaveLength(0);
		});

		it('sends nothing to disabled users', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'kim@verein.de', name: 'Kim', status: 'disabled' });
			await expect(requestLoginLink(auth, 'kim@verein.de')).resolves.toBeUndefined();
			expect(mailer.sent).toHaveLength(0);
		});

		it('resolves when the mailer fails and logs no link', async () => {
			const attempted: SystemMail[] = [];
			const failingMailer: SystemMailer = {
				// oxlint-disable-next-line typescript/require-await -- the fake rejects immediately
				async send(mail) {
					attempted.push({ ...mail });
					throw new MailerNotConfiguredError();
				},
			};
			const { auth, db } = await setup({}, failingMailer);
			const logged = vi.spyOn(console, 'error').mockReturnValue();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });

			await expect(requestLoginLink(auth, 'anna@verein.de')).resolves.toBeUndefined();

			expect(attempted).toHaveLength(1);
			expect(logged).toHaveBeenCalledWith('login link not sent', 'MailerNotConfiguredError');
			expect(JSON.stringify(logged.mock.calls)).not.toContain(lastToken(attempted));
		});
	});

	describe(verifyLoginLink, () => {
		it('activates an invited user on first verification and opens a session', async () => {
			const { db, mailer, auth } = await setupCapturing();
			const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			const { userId, setCookie } = await verifyLoginLink(auth, lastToken(mailer.sent));
			expect(userId).toBe(id);
			await expect(findUserByEmail(db, 'anna@verein.de')).resolves.toMatchObject({
				status: 'active',
			});
			await expect(getSessionUser(auth, db, cookieHeaders(setCookie))).resolves.toMatchObject({
				email: 'anna@verein.de',
				id,
				isAdmin: false,
			});
		});

		it('rejects a link used twice', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			const token = lastToken(mailer.sent);
			await verifyLoginLink(auth, token);
			await expect(verifyLoginLink(auth, token)).rejects.toBeInstanceOf(LoginLinkInvalidError);
		});

		it('accepts a link within 15 minutes', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			const { db, mailer, auth } = await setupCapturing();
			const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			const token = lastToken(mailer.sent);
			vi.setSystemTime(Date.now() + FIFTEEN_MINUTES - 60_000);
			await expect(verifyLoginLink(auth, token)).resolves.toMatchObject({ userId: id });
		});

		it('rejects a link after 15 minutes', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			const token = lastToken(mailer.sent);
			vi.setSystemTime(Date.now() + FIFTEEN_MINUTES + 60_000);
			await expect(verifyLoginLink(auth, token)).rejects.toBeInstanceOf(LoginLinkInvalidError);
		});

		it('rejects an unknown token', async () => {
			const { auth } = await setup();
			await expect(verifyLoginLink(auth, 'not-a-token')).rejects.toBeInstanceOf(
				LoginLinkInvalidError,
			);
		});

		it('rejects a link of a user disabled after it was sent and opens no session', async () => {
			const { db, mailer, auth } = await setupCapturing();
			const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			const token = lastToken(mailer.sent);
			await db.update(user).set({ status: 'disabled' }).where(eq(user.id, id));
			await expect(verifyLoginLink(auth, token)).rejects.toBeInstanceOf(LoginLinkInvalidError);
			await expect(db.select().from(session).where(eq(session.userId, id))).resolves.toHaveLength(
				0,
			);
			await expect(findUserByEmail(db, 'anna@verein.de')).resolves.toMatchObject({
				status: 'disabled',
			});
		});
	});

	describe(getSessionUser, () => {
		it('returns null without a session cookie', async () => {
			const { auth, db } = await setup();
			await expect(getSessionUser(auth, db, new Headers())).resolves.toBeNull();
		});

		it('returns the admin flag of the user', async () => {
			const context = await setupCapturing();
			const { headers, id } = await signIn(context, { email: 'anna@verein.de', isAdmin: true });
			await expect(getSessionUser(context.auth, context.db, headers)).resolves.toStrictEqual({
				email: 'anna@verein.de',
				id,
				isAdmin: true,
				name: 'Anna',
			});
		});

		it('getSessionUser returns null once the user is disabled', async () => {
			const context = await setupCapturing();
			const { headers, id } = await signIn(context, { email: 'anna@verein.de' });
			await expect(getSessionUser(context.auth, context.db, headers)).resolves.not.toBeNull();
			await context.db.update(user).set({ status: 'disabled' }).where(eq(user.id, id));
			await expect(getSessionUser(context.auth, context.db, headers)).resolves.toBeNull();
		});

		it('returns null once the sessions are revoked', async () => {
			const context = await setupCapturing();
			const { headers, id } = await signIn(context, { email: 'anna@verein.de' });
			await revokeSessions(context.db, id);
			await expect(getSessionUser(context.auth, context.db, headers)).resolves.toBeNull();
		});
	});

	describe(createAuth, () => {
		it('does not let a user set the admin flag or the status', async () => {
			const context = await setupCapturing();
			const { headers } = await signIn(context, { email: 'anna@verein.de' });
			headers.set('content-type', 'application/json');
			headers.set('origin', APP_URL);
			const updateUser = async (body: Readonly<Record<string, unknown>>): Promise<number> => {
				const request = new Request(`${APP_URL}/api/auth/update-user`, {
					body: JSON.stringify(body),
					headers,
					method: 'POST',
				});
				const response = await context.auth.handler(request);
				return response.status;
			};
			await expect(updateUser({ isAdmin: true })).resolves.toBe(400);
			await expect(updateUser({ status: 'disabled' })).resolves.toBe(400);
			await expect(findUserByEmail(context.db, 'anna@verein.de')).resolves.toMatchObject({
				isAdmin: false,
				status: 'active',
			});
		});

		it('offers no sign-up with email and password', async () => {
			const { auth, db } = await setup();
			await expect(
				auth.api.signUpEmail({
					body: { email: 'neu@example.org', name: 'Neu', password: 'p'.repeat(16) },
				}),
			).rejects.toThrow();
			await expect(db.select().from(user)).resolves.toHaveLength(0);
		});

		it('has no Microsoft provider when Microsoft login is not configured', async () => {
			const { auth } = await setup();
			await expect(
				auth.api.signInSocial({ body: { callbackURL: '/', provider: 'microsoft' } }),
			).rejects.toThrow();
		});

		it('restricts the Microsoft provider to the configured tenant', async () => {
			const { auth } = await setup({
				MS_LOGIN_CLIENT_ID: 'client-id',
				MS_LOGIN_CLIENT_SECRET: 'client-secret',
				MS_LOGIN_TENANT_ID: 'verein-tenant',
			});
			const { url } = await auth.api.signInSocial({
				body: { callbackURL: '/', provider: 'microsoft' },
			});
			expect(url).toMatch(
				/^https:\/\/login\.microsoftonline\.com\/verein-tenant\/oauth2\/v2\.0\/authorize\?/u,
			);
		});
	});
});
