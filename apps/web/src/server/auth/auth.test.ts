import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { t } from '../../i18n/t';
import { deriveLoginWindowKey, hashLoginWindowEmail } from '../crypto/secrets';
import type { Db } from '../db/client';
import { loginLinkWindow, session, user, verification } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { parseEnv } from '../env';
import type { Env } from '../env';
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
	env: Env;
	mailer: CapturingMailer;
}

interface SetupOptions {
	extraEnv?: Readonly<Record<string, string>>;
	mailer?: Readonly<SystemMailer>;
	runInBackground?: (promise: Readonly<Promise<unknown>>) => void;
}

async function setup(options: Readonly<SetupOptions> = {}): Promise<Omit<Setup, 'mailer'>> {
	const db = await createTestDb();
	const env = parseEnv({ ...baseEnv, ...options.extraEnv });
	const { mailer = new CapturingMailer(), runInBackground } = options;
	const auth = await createAuth({ db, env, mailer, runInBackground });
	return { auth, db, env };
}

async function setupCapturing(extraEnv: Readonly<Record<string, string>> = {}): Promise<Setup> {
	const mailer = new CapturingMailer();
	return { ...(await setup({ extraEnv, mailer })), mailer };
}

/**
 * Requests a login link through Better Auth's HTTP endpoint, as the login page does.
 *
 * @param auth The auth instance.
 * @param email The address as sent by the client.
 * @param ip The client address the proxy reports.
 * @returns The HTTP status of the response.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the Better Auth instance is mutable
async function requestLinkOverHttp(auth: Auth, email: string, ip = '203.0.113.7'): Promise<number> {
	const request = new Request(`${APP_URL}/api/auth/sign-in/magic-link`, {
		body: JSON.stringify({ email }),
		headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
		method: 'POST',
	});
	const response = await auth.handler(request);
	return response.status;
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

/**
 * Lists the paths Better Auth routes over HTTP that are neither used nor disabled.
 *
 * @param auth The auth instance.
 * @param used The paths the app serves on purpose.
 * @returns The paths that are open without a reason.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the Better Auth instance is mutable
function openUnusedPaths(auth: Auth, used: ReadonlySet<string>): string[] {
	const disabled = new Set(auth.options.disabledPaths);
	const open: string[] = [];
	for (const endpoint of Object.values(auth.api)) {
		// Server-only endpoints have no path.
		const { path }: { path?: unknown } = endpoint;
		if (typeof path === 'string' && !used.has(path) && !disabled.has(path)) open.push(path);
	}
	return open;
}

/**
 * Moves every login link window back in time, as if the seconds had passed (the window uses the
 * database clock, which a test cannot fake).
 *
 * @param db The database.
 * @param seconds How far to move the windows back.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
async function ageWindows(db: Db, seconds: number): Promise<void> {
	await db
		.update(loginLinkWindow)
		.set({ openedAt: sql`${loginLinkWindow.openedAt} - make_interval(secs => ${seconds})` });
}

/**
 * The key of an address in `login_link_window`.
 *
 * @param env The environment with the app secret.
 * @param email The normalized address.
 * @returns The HMAC of the address.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Env holds a URL and a Uint8Array, which cannot be readonly
async function windowHash(env: Readonly<Env>, email: string): Promise<string> {
	return hashLoginWindowEmail(await deriveLoginWindowKey(env.appSecret), email);
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
			const background: Readonly<Promise<unknown>>[] = [];
			const { auth, db } = await setup({
				mailer: failingMailer,
				runInBackground(promise) {
					background.push(promise);
				},
			});
			const logged = vi.spyOn(console, 'error').mockReturnValue();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });

			await expect(requestLoginLink(auth, 'anna@verein.de')).resolves.toBeUndefined();
			await Promise.all(background);

			expect(background).toHaveLength(1);
			expect(attempted).toHaveLength(1);
			expect(logged).toHaveBeenCalledWith('login link not sent', 'MailerNotConfiguredError');
			expect(JSON.stringify(logged.mock.calls)).not.toContain(lastToken(attempted));
		});

		it('does not wait for the mail to be sent', async () => {
			const attempted: SystemMail[] = [];
			const stuckMailer: SystemMailer = {
				async send(mail) {
					attempted.push({ ...mail });
					// A mail server that never answers: this promise never settles.
					await Promise.withResolvers<never>().promise;
				},
			};
			const { auth, db } = await setup({ mailer: stuckMailer });
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await expect(requestLoginLink(auth, 'anna@verein.de')).resolves.toBeUndefined();
			expect(attempted).toHaveLength(1);
		});

		it('answers 429 once one client exceeds the link request limit', async () => {
			const { auth } = await setup();
			const statuses: number[] = [];
			for (let attempt = 1; attempt <= 6; attempt += 1) {
				// oxlint-disable-next-line no-await-in-loop -- the requests must count one after the other
				statuses.push(await requestLinkOverHttp(auth, 'fremd@example.org'));
			}
			expect(statuses).toStrictEqual([200, 200, 200, 200, 200, 429]);
			await expect(requestLinkOverHttp(auth, 'fremd@example.org', '203.0.113.8')).resolves.toBe(
				200,
			);
		});

		it('stores only a hash of the link token', async () => {
			const { db, mailer, auth } = await setupCapturing();
			const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			const token = lastToken(mailer.sent);
			const rows = await db.select({ identifier: verification.identifier }).from(verification);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.identifier).toMatch(/^magic-link:/u);
			expect(rows[0]?.identifier).not.toContain(token);
			await expect(verifyLoginLink(auth, token)).resolves.toMatchObject({ userId: id });
		});
	});

	describe('login link window', () => {
		it('sends the first request of a window', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			expect(mailer.sent).toMatchObject([{ to: 'anna@verein.de' }]);
		});

		it('sends nothing for a second request within 60 seconds', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await insertUser(db, { email: 'kim@verein.de', name: 'Kim' });
			await requestLoginLink(auth, 'anna@verein.de');
			// The HTTP endpoint gets the address as typed; the window must still match it.
			await expect(requestLinkOverHttp(auth, 'Anna@Verein.DE')).resolves.toBe(200);
			await requestLoginLink(auth, 'kim@verein.de');
			expect(mailer.sent).toMatchObject([{ to: 'anna@verein.de' }, { to: 'kim@verein.de' }]);
		});

		it('sends again once the window has passed', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			await ageWindows(db, 61);
			await requestLoginLink(auth, 'anna@verein.de');
			expect(mailer.sent).toHaveLength(2);
		});

		it('is not extended by requests inside an open window', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLoginLink(auth, 'anna@verein.de');
			const sentAfter = [mailer.sent.length];
			// Someone requests the address every 50 seconds.
			for (let step = 1; step <= 4; step += 1) {
				// oxlint-disable-next-line no-await-in-loop -- each step builds on the clock of the last
				await ageWindows(db, 50);
				// oxlint-disable-next-line no-await-in-loop -- see above
				await requestLoginLink(auth, 'anna@verein.de');
				sentAfter.push(mailer.sent.length);
			}
			// Requests at 0, 50, 100, 150 and 200 seconds: the ones at 100 and 200 open a new window.
			expect(sentAfter).toStrictEqual([1, 1, 2, 2, 3]);
		});

		it('opens the window for unknown and disabled addresses too, but sends nothing', async () => {
			const { db, env, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'kim@verein.de', name: 'Kim', status: 'disabled' });
			await requestLoginLink(auth, 'fremd@example.org');
			await requestLoginLink(auth, 'kim@verein.de');
			expect(mailer.sent).toHaveLength(0);
			const rows = await db.select({ emailHash: loginLinkWindow.emailHash }).from(loginLinkWindow);
			expect(rows).toHaveLength(2);
			expect(rows).toStrictEqual(
				expect.arrayContaining([
					{ emailHash: await windowHash(env, 'fremd@example.org') },
					{ emailHash: await windowHash(env, 'kim@verein.de') },
				]),
			);
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
		it('does not serve /update-user, so a user cannot touch the admin flag or the status', async () => {
			const context = await setupCapturing();
			const { headers } = await signIn(context, { email: 'anna@verein.de' });
			headers.set('content-type', 'application/json');
			headers.set('origin', APP_URL);
			const request = new Request(`${APP_URL}/api/auth/update-user`, {
				body: JSON.stringify({ isAdmin: true, status: 'active' }),
				headers,
				method: 'POST',
			});
			const response = await context.auth.handler(request);
			expect(response.status).toBe(404);
			await expect(findUserByEmail(context.db, 'anna@verein.de')).resolves.toMatchObject({
				isAdmin: false,
				status: 'active',
			});
		});

		it('disables every routed endpoint the app does not use', async () => {
			const { auth } = await setup();
			const used = new Set([
				'/callback/:id',
				'/error',
				'/get-session',
				'/magic-link/verify',
				'/ok',
				// `disabledPaths` matches exact paths only, so a route with a parameter cannot be
				// listed. No reset token is ever issued (no passwords), so it only answers with an error.
				'/reset-password/:token',
				'/sign-in/magic-link',
				'/sign-in/social',
				'/sign-out',
			]);
			expect(openUnusedPaths(auth, used)).toStrictEqual([]);
			expect(auth.options.disabledPaths).toContain('/update-user');
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
				extraEnv: {
					MS_LOGIN_CLIENT_ID: 'client-id',
					MS_LOGIN_CLIENT_SECRET: 'client-secret',
					MS_LOGIN_TENANT_ID: 'verein-tenant',
				},
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
