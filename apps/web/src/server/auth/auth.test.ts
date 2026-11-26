import { format } from 'node:util';

import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { translate } from '@/i18n/translate';
import { setUpClub } from '@/server/contacts/testing';
import { deriveLoginWindowKey, hashLoginWindowEmail } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { loginLinkDays, loginLinkWindow, session, user, verification } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';
import type { Env } from '@/server/env';
import type { SmtpMail } from '@/server/mail/smtp-transport';
import { createSystemMailer, MailerNotConfiguredError } from '@/server/mail/system-mailer';
import type { SystemMail, SystemMailer } from '@/server/mail/system-mailer';
import { CapturingMailer } from '@/server/mail/testing';
import { setSystemSender } from '@/server/sending/senders';
import { fakeProviders, graphConnection, senderOn, testEnv } from '@/server/sending/testing';
import { findUserByEmail, insertUser, revokeSessions } from '@/server/users/repo';

import {
	createAuth,
	createSessionFor,
	handleAuthRequest,
	LoginLinkInvalidError,
	requestLoginLink,
	SESSION_NOT_CREATED,
	verifyLoginLink,
} from './auth';
import type { Auth } from './auth';
import { LOGIN_LINKS_PER_DAY } from './login-link-days';
import { getSessionUser } from './session';

/** What the SMTP double was handed: the `DEV_SMTP_URL` path delivers to it, not to a server. */
const smtp = vi.hoisted(() => ({ sent: [] as SmtpMail[] }));

vi.mock(import('@/server/mail/smtp-transport'), async (importOriginal) => ({
	...(await importOriginal()),
	openSmtpTransport: () => ({
		// oxlint-disable-next-line typescript/require-await, typescript/prefer-readonly-parameter-types -- the double records, it does not send; nodemailer's mail holds a mutable list
		async sendMail(mail: SmtpMail) {
			smtp.sent.push({ ...mail });
		},
	}),
}));

const FIFTEEN_MINUTES = 15 * 60_000;
const APP_URL = 'https://bote.example.org';
/** Noon in Berlin. */
const NOON = new Date('2026-11-25T11:00:00Z');
/** Midnight in Berlin after `NOON`: the next club day. */
const NEXT_MIDNIGHT = new Date('2026-11-25T23:00:00Z');

/** Resolves on the next macrotask, once a delivery started by the last request has begun. */
async function nextMacrotask(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<null>();
	setTimeout(() => {
		resolve(null);
	}, 0);
	await promise;
}

/**
 * Requests a login link and waits until a delivery it started has begun. The delivery starts one
 * macrotask after the request (`createLinkSender`); timers of the same delay run in the order they
 * were set, so it has begun when this one fires, and the capturing mailers record synchronously.
 *
 * @param auth The auth instance.
 * @param email The address as typed.
 */
async function requestLink(auth: Auth, email: string): Promise<void> {
	await requestLoginLink(auth, email);
	await nextMacrotask();
}

/** The `send` of a fake mailer that only prepares: login links never use it. */
// oxlint-disable-next-line typescript/require-await -- the fake rejects immediately
async function unused(): Promise<void> {
	throw new Error('The login link is prepared, never sent directly.');
}

/** A delivery that sends nothing. */
async function noDelivery(): Promise<void> {
	// Nothing to deliver.
}

/** A delivery of a mailer without a transport. */
// oxlint-disable-next-line typescript/require-await -- the fake rejects immediately
async function notConfigured(): Promise<void> {
	throw new MailerNotConfiguredError();
}

/** A delivery to a mail server that never answers: the promise never settles. */
async function neverAnswers(): Promise<void> {
	await Promise.withResolvers<never>().promise;
}

interface FakeMailer {
	readonly mailer: SystemMailer;
	/** The address of each prepared mail, null for a preparation without a mail. */
	readonly prepared: (string | null)[];
	/** The mails whose delivery started. */
	readonly delivered: SystemMail[];
}

/**
 * A mailer that records what each request prepared and runs `deliver` for a prepared mail.
 *
 * @param deliver What the delivery of a mail does.
 * @returns The mailer and its records.
 */
function fakeMailer(deliver: () => Promise<void>): FakeMailer {
	const prepared: (string | null)[] = [];
	const delivered: SystemMail[] = [];
	const mailer: SystemMailer = {
		// oxlint-disable-next-line typescript/require-await -- the fake prepares at once
		async prepare(mail) {
			prepared.push(mail?.to ?? null);
			if (mail === null) return null;
			return async () => {
				delivered.push({ ...mail });
				await deliver();
			};
		},
		send: unused,
	};
	return { delivered, mailer, prepared };
}

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
 * A login link request to Better Auth's HTTP endpoint, as the login page sends it.
 *
 * @param email The address as sent by the client.
 * @param ip The client address the proxy reports.
 * @returns The request.
 */
function linkRequest(email: string, ip = '203.0.113.7'): Request {
	return new Request(`${APP_URL}/api/auth/sign-in/magic-link`, {
		body: JSON.stringify({ email }),
		headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
		method: 'POST',
	});
}

/**
 * Requests a login link through Better Auth's HTTP endpoint, as the login page does.
 *
 * @param auth The auth instance.
 * @param email The address as sent by the client.
 * @param ip The client address the proxy reports.
 * @returns The HTTP status of the response.
 */
async function requestLinkOverHttp(auth: Auth, email: string, ip?: string): Promise<number> {
	const response = await handleAuthRequest(auth, linkRequest(email, ip));
	// A delivery the request started has begun then, see `requestLink`.
	await nextMacrotask();
	return response.status;
}

function tokenFrom(text: string): string {
	const token = /token=(?<token>[^&\s]+)/u.exec(text)?.groups?.token;
	if (token === undefined) throw new Error('The mail contains no token.');
	return token;
}

/**
 * Reads the login link in the last mail.
 *
 * @param sent The mails sent so far.
 * @returns The link.
 */
function lastLink(sent: readonly Readonly<SystemMail>[]): URL {
	return new URL(sent.at(-1)?.content.button?.url ?? 'about:blank');
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
	return tokenFrom(mail.content.button?.url ?? '');
}

/**
 * The texts of a mail, one below the other.
 *
 * @param mail The mail.
 * @returns The heading and the paragraphs.
 */
function textOf(mail: Readonly<SystemMail> | undefined): string {
	return [mail?.content.heading ?? '', ...(mail?.content.paragraphs ?? [])].join('\n');
}

/**
 * Lists the paths Better Auth routes over HTTP that are neither used nor disabled.
 *
 * @param auth The auth instance.
 * @param used The paths the app serves on purpose.
 * @returns The paths that are open without a reason.
 */
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
async function windowHash(env: Env, email: string): Promise<string> {
	return hashLoginWindowEmail(await deriveLoginWindowKey(env.appSecret), email);
}

const cookieHeaders = (setCookie: string): Headers =>
	new Headers({ cookie: setCookie.split(';')[0] ?? '' });

/**
 * Captures what goes to the console, formatted the way the console prints it (an error with its
 * message, stack and cause).
 *
 * @returns A function that returns everything logged so far.
 */
function captureConsole(): () => string {
	const spies = [
		vi.spyOn(console, 'error').mockReturnValue(),
		vi.spyOn(console, 'warn').mockReturnValue(),
		vi.spyOn(console, 'info').mockReturnValue(),
		vi.spyOn(console, 'log').mockReturnValue(),
	];
	return () =>
		spies
			.flatMap((spy) => spy.mock.calls.map((args: readonly unknown[]) => format(...args)))
			.join('\n');
}

/** The ways a system mail can go: the system sender, `DEV_SMTP_URL`, or none at all. */
const MAILER_PATHS = ['system sender', 'DEV_SMTP_URL', 'none'] as const;
type MailerPath = (typeof MAILER_PATHS)[number];

interface RecordingSetup {
	readonly auth: Auth;
	readonly db: Db;
	/** Returns the SQL of every statement since the last call, in order. */
	readonly takeQueries: () => string[];
	/** The address of each mail the auth instance prepared. */
	readonly mailed: readonly string[];
	/** The deliveries started after the requests. */
	readonly background: readonly Readonly<Promise<unknown>>[];
}

/**
 * The environment of a mailer path.
 *
 * @param path The path.
 * @returns The environment; its app secret matches the stored credentials of the sending tests.
 */
function envFor(path: MailerPath): Env {
	if (path !== 'DEV_SMTP_URL') return testEnv();
	return parseEnv({
		APP_SECRET: Buffer.alloc(32, 7).toString('base64'),
		APP_URL,
		CRON_SECRET: 'c'.repeat(32),
		DATABASE_URL: 'postgres://x@localhost/x',
		DEV_SMTP_URL: 'smtp://localhost:1025',
	});
}

/**
 * An auth instance with the app's real system mailer on a database that records its statements.
 *
 * @param path How the system mails go.
 * @returns The auth instance, the database and the records.
 */
async function recordingSetup(path: MailerPath): Promise<RecordingSetup> {
	const queries: string[] = [];
	const db = await createTestDb({
		logQuery(query) {
			queries.push(query);
		},
	});
	if (path === 'system sender') {
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		await setSystemSender(db, admin, await senderOn(db, admin, connectionId, 'verein@example.org'));
	}
	const env = envFor(path);
	const real = createSystemMailer({ db, env, fetch: fakeProviders().fetch });
	const mailed: string[] = [];
	const mailer: SystemMailer = {
		async prepare(mail) {
			if (mail !== null) mailed.push(mail.to);
			return real.prepare(mail);
		},
		send: real.send,
	};
	const background: Readonly<Promise<unknown>>[] = [];
	const auth = await createAuth({
		db,
		env,
		mailer,
		runInBackground(promise) {
			background.push(promise);
		},
	});
	return { auth, background, db, mailed, takeQueries: () => queries.splice(0) };
}

/**
 * The statements a login link request runs.
 *
 * @param context The recording setup.
 * @param email The address of the request.
 * @returns The SQL of each statement, in order.
 */
async function statementsOf(context: RecordingSetup, email: string): Promise<string[]> {
	context.takeQueries();
	await requestLoginLink(context.auth, email);
	return context.takeQueries();
}

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
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Setup holds the Drizzle client and the auth instance
	{ auth, db, mailer }: Readonly<Setup>,
	input: Readonly<{ email: string; isAdmin?: boolean }>,
): Promise<{ headers: Headers; id: string }> {
	const { id } = await insertUser(db, { ...input, name: 'Anna' });
	await requestLink(auth, input.email);
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
			await requestLink(auth, ' Anna@Verein.DE');
			expect(mailer.sent).toHaveLength(1);
			expect(mailer.sent[0]).toMatchObject({
				content: { button: { label: 'Anmelden' }, heading: 'Dein Anmeldelink' },
				locale: 'de',
				subject: translate('de', 'mail.system.login.subject'),
				to: 'anna@verein.de',
			});
			expect(mailer.sent[0]?.content.button?.url).toMatch(
				/^https:\/\/bote\.example\.org\/login\/confirm\?token=[A-Za-z]+$/u,
			);
			expect(textOf(mailer.sent[0])).toContain(
				'Der Link ist 15 Minuten gültig und funktioniert einmal.',
			);
		});

		it("sends the sign-in link in the user's language", async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'kim@verein.de', locale: 'en', name: 'Kim' });
			await requestLink(auth, 'kim@verein.de');
			expect(mailer.sent).toHaveLength(1);
			expect(mailer.sent[0]).toMatchObject({
				content: { button: { label: 'Sign in' }, heading: 'Your sign-in link' },
				locale: 'en',
				subject: 'Your sign-in link for Vereinsbote',
			});
			expect(textOf(mailer.sent[0])).toContain('The link is valid for 15 minutes and works once.');
			expect(mailer.sent[0]?.content.button?.url).toContain(`${APP_URL}/`);
		});

		it('sends the sign-in link in German by default', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLink(auth, 'anna@verein.de');
			expect(mailer.sent[0]?.subject).toBe('Dein Anmeldelink für den Vereinsbote');
		});

		it('stores de as the default locale', async () => {
			const { db } = await setup();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await expect(findUserByEmail(db, 'anna@verein.de')).resolves.toMatchObject({ locale: 'de' });
		});

		it('sends a link to an active user', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna', status: 'active' });
			await requestLink(auth, 'anna@verein.de');
			expect(mailer.sent).toHaveLength(1);
			expect(mailer.sent[0]).toMatchObject({ to: 'anna@verein.de' });
		});

		it('sends nothing to unknown addresses', async () => {
			const { mailer, auth } = await setupCapturing();
			await expect(requestLink(auth, 'fremd@example.org')).resolves.toBeUndefined();
			expect(mailer.sent).toHaveLength(0);
		});

		it('sends nothing to disabled users', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'kim@verein.de', name: 'Kim', status: 'disabled' });
			await expect(requestLink(auth, 'kim@verein.de')).resolves.toBeUndefined();
			expect(mailer.sent).toHaveLength(0);
		});

		it('resolves when the mailer fails and logs no link', async () => {
			const { delivered: attempted, mailer: failingMailer } = fakeMailer(notConfigured);
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
			const { delivered: attempted, mailer: stuckMailer } = fakeMailer(neverAnswers);
			const { auth, db } = await setup({ mailer: stuckMailer });
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await expect(requestLoginLink(auth, 'anna@verein.de')).resolves.toBeUndefined();
			await nextMacrotask();
			expect(attempted).toHaveLength(1);
		});

		it('starts the delivery only after the request has returned', async () => {
			const { delivered: attempted, mailer: recording } = fakeMailer(noDelivery);
			const background: Readonly<Promise<unknown>>[] = [];
			const { auth, db } = await setup({
				mailer: recording,
				runInBackground(promise) {
					background.push(promise);
				},
			});
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });

			await requestLoginLink(auth, 'anna@verein.de');

			// Handed to the runner during the request, begun on a later macrotask.
			expect(background).toHaveLength(1);
			expect(attempted).toHaveLength(0);
			await Promise.all(background);
			expect(attempted).toMatchObject([{ to: 'anna@verein.de' }]);
		});

		it('starts the delivery only after the HTTP handler has answered', async () => {
			const { delivered: attempted, mailer: recording } = fakeMailer(noDelivery);
			const { auth, db } = await setup({ mailer: recording });
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });

			const response = await handleAuthRequest(auth, linkRequest('anna@verein.de'));

			expect(response.status).toBe(200);
			expect(attempted).toHaveLength(0);
			await nextMacrotask();
			expect(attempted).toMatchObject([{ to: 'anna@verein.de' }]);
		});

		it('links to the confirmation page instead of the verify endpoint', async () => {
			const { db, mailer, auth } = await setupCapturing();
			const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLink(auth, 'anna@verein.de');
			const link = lastLink(mailer.sent);
			expect(`${link.origin}${link.pathname}`).toBe(`${APP_URL}/login/confirm`);
			expect([...link.searchParams.keys()]).toStrictEqual(['token']);
			// Better Auth's own endpoint is closed: opening it signs nobody in and uses up nothing.
			const opened = await handleAuthRequest(
				auth,
				new Request(
					`${APP_URL}/api/auth/magic-link/verify?token=${link.searchParams.get('token')}`,
				),
			);
			expect(opened.status).toBe(404);
			await expect(db.select().from(session)).resolves.toHaveLength(0);
			await expect(verifyLoginLink(auth, lastToken(mailer.sent))).resolves.toMatchObject({
				userId: id,
			});
		});

		it('prepares the mailer for every request, with a mail only for an invited address', async () => {
			const { mailer: recording, prepared } = fakeMailer(noDelivery);
			const { auth, db } = await setup({ mailer: recording });
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await insertUser(db, { email: 'kim@verein.de', name: 'Kim', status: 'disabled' });

			await requestLoginLink(auth, 'anna@verein.de');
			// Inside the window of the address, unknown, disabled: the same work, no mail.
			await requestLoginLink(auth, 'anna@verein.de');
			await requestLoginLink(auth, 'fremd@example.org');
			await requestLoginLink(auth, 'kim@verein.de');

			expect(prepared).toStrictEqual(['anna@verein.de', null, null, null]);
		});

		it('resolves and logs by code when the mailer cannot prepare the mail', async () => {
			const broken: SystemMailer = {
				// oxlint-disable-next-line typescript/require-await -- the fake rejects immediately
				async prepare() {
					throw new MailerNotConfiguredError();
				},
				send: unused,
			};
			const background: Readonly<Promise<unknown>>[] = [];
			const { auth, db } = await setup({
				mailer: broken,
				runInBackground(promise) {
					background.push(promise);
				},
			});
			const logged = vi.spyOn(console, 'error').mockReturnValue();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });

			await expect(requestLoginLink(auth, 'anna@verein.de')).resolves.toBeUndefined();
			await expect(requestLoginLink(auth, 'fremd@example.org')).resolves.toBeUndefined();

			expect(background).toHaveLength(0);
			expect(logged.mock.calls).toStrictEqual([
				['login link not sent', 'MailerNotConfiguredError'],
			]);
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
			await requestLink(auth, 'anna@verein.de');
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
			await requestLink(auth, 'anna@verein.de');
			expect(mailer.sent).toMatchObject([{ to: 'anna@verein.de' }]);
		});

		it('sends nothing for a second request within 60 seconds', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await insertUser(db, { email: 'kim@verein.de', name: 'Kim' });
			await requestLink(auth, 'anna@verein.de');
			// The HTTP endpoint gets the address as typed; the window must still match it.
			await expect(requestLinkOverHttp(auth, 'Anna@Verein.DE')).resolves.toBe(200);
			await requestLink(auth, 'kim@verein.de');
			expect(mailer.sent).toMatchObject([{ to: 'anna@verein.de' }, { to: 'kim@verein.de' }]);
		});

		it('sends again once the window has passed', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLink(auth, 'anna@verein.de');
			await ageWindows(db, 61);
			await requestLink(auth, 'anna@verein.de');
			expect(mailer.sent).toHaveLength(2);
		});

		it('is not extended by requests inside an open window', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLink(auth, 'anna@verein.de');
			const sentAfter = [mailer.sent.length];
			// Someone requests the address every 50 seconds.
			for (let step = 1; step <= 4; step += 1) {
				// oxlint-disable-next-line no-await-in-loop -- each step builds on the clock of the last
				await ageWindows(db, 50);
				// oxlint-disable-next-line no-await-in-loop -- see above
				await requestLink(auth, 'anna@verein.de');
				sentAfter.push(mailer.sent.length);
			}
			// Requests at 0, 50, 100, 150 and 200 seconds: the ones at 100 and 200 open a new window.
			expect(sentAfter).toStrictEqual([1, 1, 2, 2, 3]);
		});

		it('opens the window for unknown and disabled addresses too, but sends nothing', async () => {
			const { db, env, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'kim@verein.de', name: 'Kim', status: 'disabled' });
			await requestLink(auth, 'fremd@example.org');
			await requestLink(auth, 'kim@verein.de');
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

	describe('login links per day', () => {
		it('sends at most ten login links per address and club day', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(NOON);
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			for (let request = 1; request <= 11; request += 1) {
				// oxlint-disable-next-line no-await-in-loop -- each request opens a window of its own
				await requestLink(auth, 'anna@verein.de');
				// oxlint-disable-next-line no-await-in-loop -- see above
				await ageWindows(db, 61);
			}
			expect(mailer.sent).toHaveLength(10);

			// The next club day begins at midnight in Berlin.
			vi.setSystemTime(NEXT_MIDNIGHT);
			await requestLink(auth, 'anna@verein.de');
			expect(mailer.sent).toHaveLength(11);
		});

		it('counts unknown addresses the same way', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(NOON);
			const { db, env, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			for (let request = 1; request <= 11; request += 1) {
				// oxlint-disable-next-line no-await-in-loop -- each request opens a window of its own
				await requestLink(auth, 'anna@verein.de');
				// oxlint-disable-next-line no-await-in-loop -- see above
				await requestLink(auth, 'fremd@example.org');
				// oxlint-disable-next-line no-await-in-loop -- see above
				await ageWindows(db, 61);
			}
			const rows = await db
				.select({ count: loginLinkDays.count, day: loginLinkDays.day })
				.from(loginLinkDays)
				.where(eq(loginLinkDays.emailHash, await windowHash(env, 'fremd@example.org')));
			expect(rows).toStrictEqual([{ count: LOGIN_LINKS_PER_DAY, day: '2026-11-25' }]);
			const annaHash = await windowHash(env, 'anna@verein.de');
			await expect(
				db
					.select({ count: loginLinkDays.count })
					.from(loginLinkDays)
					.where(eq(loginLinkDays.emailHash, annaHash)),
			).resolves.toStrictEqual([{ count: LOGIN_LINKS_PER_DAY }]);
		});

		it('counts only the requests that open a window', async () => {
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLink(auth, 'anna@verein.de');
			await requestLink(auth, 'anna@verein.de');
			await requestLink(auth, 'anna@verein.de');
			expect(mailer.sent).toHaveLength(1);
			await expect(
				db.select({ count: loginLinkDays.count }).from(loginLinkDays),
			).resolves.toStrictEqual([{ count: 1 }]);
		});
	});

	describe('statements of a login link request', () => {
		it.each(MAILER_PATHS)(
			'are the same for every address, with or without a link, through %s',
			async (path) => {
				// Without a transport the one link that would go out is logged as not sent.
				vi.spyOn(console, 'error').mockReturnValue();
				const context = await recordingSetup(path);
				const { db } = context;
				await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
				await insertUser(db, { email: 'kim@verein.de', name: 'Kim', status: 'disabled' });

				const sent = await statementsOf(context, 'anna@verein.de');
				const inWindow = await statementsOf(context, 'anna@verein.de');
				const unknown = await statementsOf(context, 'fremd@example.org');
				const disabled = await statementsOf(context, 'kim@verein.de');
				await db.update(loginLinkDays).set({ count: LOGIN_LINKS_PER_DAY });
				await ageWindows(db, 61);
				const overDailyLimit = await statementsOf(context, 'anna@verein.de');
				await Promise.all(context.background);

				expect(context.mailed).toStrictEqual(['anna@verein.de']);
				expect(sent.filter((query) => query.includes('"login_link_days"'))).toHaveLength(1);
				expect({ disabled, inWindow, overDailyLimit, unknown }).toStrictEqual({
					disabled: sent,
					inWindow: sent,
					overDailyLimit: sent,
					unknown: sent,
				});
			},
		);
	});

	describe(verifyLoginLink, () => {
		it('activates an invited user on first verification and opens a session', async () => {
			const { db, mailer, auth } = await setupCapturing();
			const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLink(auth, 'anna@verein.de');
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
			await requestLink(auth, 'anna@verein.de');
			const token = lastToken(mailer.sent);
			await verifyLoginLink(auth, token);
			await expect(verifyLoginLink(auth, token)).rejects.toBeInstanceOf(LoginLinkInvalidError);
		});

		it('accepts a link within 15 minutes', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			const { db, mailer, auth } = await setupCapturing();
			const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLink(auth, 'anna@verein.de');
			const token = lastToken(mailer.sent);
			vi.setSystemTime(Date.now() + FIFTEEN_MINUTES - 60_000);
			await expect(verifyLoginLink(auth, token)).resolves.toMatchObject({ userId: id });
		});

		it('rejects a link after 15 minutes', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			const { db, mailer, auth } = await setupCapturing();
			await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			await requestLink(auth, 'anna@verein.de');
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
			await requestLink(auth, 'anna@verein.de');
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

	describe(createSessionFor, () => {
		it('opens a session for an active user without a login link', async () => {
			const { auth, db, mailer } = await setupCapturing();
			const { id } = await insertUser(db, {
				email: 'alex@verein.de',
				isAdmin: true,
				name: 'Alex',
				status: 'active',
			});
			const { setCookie } = await createSessionFor(auth, id);
			await expect(getSessionUser(auth, db, cookieHeaders(setCookie))).resolves.toStrictEqual({
				email: 'alex@verein.de',
				id,
				isAdmin: true,
				name: 'Alex',
			});
			await expect(db.select().from(session).where(eq(session.userId, id))).resolves.toHaveLength(
				1,
			);
			expect(mailer.sent).toHaveLength(0);
		});

		it('sets an HttpOnly, SameSite=Lax, Secure cookie for an https APP_URL', async () => {
			const { auth, db } = await setup();
			const { id } = await insertUser(db, {
				email: 'alex@verein.de',
				name: 'Alex',
				status: 'active',
			});
			const { setCookie } = await createSessionFor(auth, id);
			expect(setCookie).toMatch(/^__Secure-better-auth\.session_token=[^;]+;/u);
			expect(setCookie).toMatch(/; Secure(?:;|$)/u);
			expect(setCookie).toContain('HttpOnly');
			expect(setCookie).toContain('SameSite=Lax');
		});

		it('sets a plain session cookie for a local http APP_URL', async () => {
			const { auth, db } = await setup({ extraEnv: { APP_URL: 'http://localhost:3000' } });
			const { id } = await insertUser(db, {
				email: 'alex@verein.de',
				name: 'Alex',
				status: 'active',
			});
			const { setCookie } = await createSessionFor(auth, id);
			expect(setCookie).toMatch(/^better-auth\.session_token=[^;]+;/u);
			expect(setCookie).not.toMatch(/; Secure(?:;|$)/u);
			await expect(getSessionUser(auth, db, cookieHeaders(setCookie))).resolves.toMatchObject({
				id,
			});
		});

		it('opens no session for a disabled user', async () => {
			const { auth, db } = await setup();
			const { id } = await insertUser(db, {
				email: 'kim@verein.de',
				name: 'Kim',
				status: 'disabled',
			});
			await expect(createSessionFor(auth, id)).rejects.toThrow(SESSION_NOT_CREATED);
			await expect(db.select().from(session)).resolves.toHaveLength(0);
		});

		it('opens no session for an unknown user', async () => {
			const { auth, db } = await setup();
			await expect(createSessionFor(auth, crypto.randomUUID())).rejects.toThrow(
				SESSION_NOT_CREATED,
			);
			await expect(db.select().from(session)).resolves.toHaveLength(0);
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

	describe('logging', () => {
		it('logs a failed session lookup by code, without the token or the query', async () => {
			const context = await setupCapturing();
			const { headers } = await signIn(context, { email: 'anna@verein.de' });
			const [stored] = await context.db.select({ token: session.token }).from(session);
			await context.db.execute(sql`alter table "session" rename to "session_gone"`);
			const logged = captureConsole();
			await context.auth.api.getSession({ headers }).catch(() => null);
			const output = logged();
			expect(output).not.toBe('');
			expect(output).not.toContain(stored?.token);
			expect(output).not.toContain('params');
			expect(output).not.toContain('session_gone');
		});

		it('logs a 5xx response of Better Auth by its status only', async () => {
			const logged = captureConsole();
			const failing = {
				// oxlint-disable-next-line typescript/require-await -- the fake resolves immediately
				handler: async () => new Response('db down at anna@verein.de', { status: 503 }),
			};
			const request = new Request(`${APP_URL}/api/auth/sign-out`, { method: 'POST' });
			const response = await handleAuthRequest(failing, request);
			expect(response.status).toBe(503);
			expect(logged()).toBe('better auth HTTP 503');
		});

		it('does not log a 4xx response of Better Auth', async () => {
			const logged = captureConsole();
			const refusing = {
				// oxlint-disable-next-line typescript/require-await -- the fake resolves immediately
				handler: async () => new Response(null, { status: 404 }),
			};
			const request = new Request(`${APP_URL}/api/auth/get-session`);
			await expect(handleAuthRequest(refusing, request)).resolves.toMatchObject({ status: 404 });
			expect(logged()).toBe('');
		});

		it('logs a failed login link request without the address', async () => {
			const { auth, db } = await setup();
			await db.execute(sql`alter table "user" rename to "user_gone"`);
			const logged = captureConsole();
			await expect(requestLinkOverHttp(auth, 'anna@verein.de')).resolves.toBe(500);
			const output = logged();
			expect(output).not.toBe('');
			expect(output).not.toContain('@');
			expect(output).not.toContain('params');
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
			// Links are confirmed on the app's own page (`/login/confirm`), never by a GET here.
			expect(auth.options.disabledPaths).toContain('/magic-link/verify');
		});

		it('does not serve /get-session, while the server still reads sessions', async () => {
			const context = await setupCapturing();
			const { headers, id } = await signIn(context, { email: 'anna@verein.de' });
			const request = new Request(`${APP_URL}/api/auth/get-session`, { headers });
			await expect(handleAuthRequest(context.auth, request)).resolves.toMatchObject({
				status: 404,
			});
			await expect(context.auth.api.getSession({ headers })).resolves.toMatchObject({
				user: { id },
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
				extraEnv: {
					MS_LOGIN_CLIENT_ID: 'client-id',
					MS_LOGIN_CLIENT_SECRET: 'client-secret',
					MS_LOGIN_TENANT_ID: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
				},
			});
			const { url } = await auth.api.signInSocial({
				body: { callbackURL: '/', provider: 'microsoft' },
			});
			expect(url).toMatch(
				/^https:\/\/login\.microsoftonline\.com\/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b\/oauth2\/v2\.0\/authorize\?/u,
			);
		});
	});
});
