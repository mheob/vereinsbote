import { betterAuth } from 'better-auth';
import type { SocialProviders } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { isAPIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import {
	deriveAuthSecret,
	deriveLoginWindowKey,
	hashLoginWindowEmail,
} from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import {
	account,
	loginLinkWindow,
	rateLimit,
	session,
	user,
	verification,
} from '@/server/db/schema';
import type { Env } from '@/server/env';
import type { SystemMailer } from '@/server/mail/system-mailer';
import { activateInvitedUser, findUserByEmail, findUserById } from '@/server/users/repo';

import { normalizeEmail } from './email';

/** 15 minutes. */
const LOGIN_LINK_TTL_SECONDS = 900;
/** 7 days. */
const SESSION_TTL_SECONDS = 604_800;
/** 1 day: a session used after this age gets a fresh `SESSION_TTL_SECONDS` (sliding expiry). */
const SESSION_REFRESH_AGE_SECONDS = 86_400;
/** Where a login link leads after a successful check, and where it leads after a failed one. */
const AFTER_SIGN_IN_PATH = '/';
const LOGIN_PATH = '/login';
/** At most one login link per address and window; requests inside an open window send nothing. */
const LOGIN_LINK_WINDOW_SECONDS = 60;
/** Login link requests per client address and window, enforced by Better Auth's rate limiter. */
const LINK_REQUESTS_PER_WINDOW = 5;
const LINK_REQUEST_WINDOW_SECONDS = 60;

/**
 * Where the rate limiter reads the client address, per platform (build constant). Cloudflare
 * sets `cf-connecting-ip`, Vercel sets `x-forwarded-for` to the client address. Node (Docker)
 * must run behind a reverse proxy that sets `x-forwarded-for` to the single client address;
 * otherwise all clients share one bucket.
 */
const IP_ADDRESS_HEADERS =
	import.meta.env.VITE_VB_PLATFORM === 'cloudflare' ? ['cf-connecting-ip'] : ['x-forwarded-for'];

/**
 * Every routed Better Auth endpoint except the ones the app uses: `/sign-in/magic-link`,
 * `/magic-link/verify`, `/sign-in/social`, `/callback/:id` (Microsoft), `/get-session`,
 * `/sign-out`, `/ok` and `/error`. A test keeps this list complete for new Better Auth versions.
 */
const DISABLED_PATHS = [
	'/account-info',
	'/change-email',
	'/change-password',
	'/delete-user',
	'/delete-user/callback',
	'/get-access-token',
	'/link-social',
	'/list-accounts',
	'/list-sessions',
	'/refresh-token',
	'/request-password-reset',
	'/reset-password',
	'/revoke-other-sessions',
	'/revoke-session',
	'/revoke-sessions',
	'/send-verification-email',
	'/sign-in/email',
	'/sign-up/email',
	'/unlink-account',
	'/update-session',
	'/update-user',
	'/verify-email',
	'/verify-password',
];

/** Keeps a promise running after the response, like `waitUntil`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
type BackgroundRunner = (promise: Promise<unknown>) => void;

interface AuthDeps {
	db: Db;
	env: Env;
	mailer: SystemMailer;
	/** Runs the sending of login links after the response. Defaults to `runDetached`. */
	runInBackground?: BackgroundRunner;
}

/** The login link is unknown, expired, already used, or its user may not sign in. */
class LoginLinkInvalidError extends Error {
	public constructor() {
		super('The login link is invalid, expired or already used.');
		this.name = 'LoginLinkInvalidError';
	}
}

/**
 * Logs that a login link could not be sent. Code or name only: the message of a transport error
 * may carry connection details, and the mail itself carries the link.
 *
 * @param error The error of the mailer.
 */
function logSendFailure(error: unknown): void {
	const label =
		error instanceof Error
			? (('code' in error ? String(error.code) : undefined) ?? error.name)
			: 'unknown';
	// oxlint-disable-next-line no-console -- the only trace of a login link that never arrives
	console.error('login link not sent', label);
}

/**
 * Default background runner: lets the promise finish on its own, which a Node process allows.
 *
 * @param promise The work to finish after the response.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
function runDetached(promise: Promise<unknown>): void {
	// oxlint-disable-next-line promise/prefer-await-to-then -- nothing awaits a detached promise
	promise.catch(logSendFailure);
}

/**
 * Sends a login link in the recipient's language. Never rejects: a failure is logged, since
 * nobody waits for it.
 *
 * @param mailer The mailer.
 * @param mail The mail.
 * @param mail.to The normalized address.
 * @param mail.link The login link.
 * @param mail.locale The recipient's stored language (`user.locale`).
 */
async function sendLoginLink(
	mailer: Readonly<SystemMailer>,
	{ to, link, locale }: Readonly<{ to: string; link: string; locale: Locale }>,
): Promise<void> {
	try {
		await mailer.send({
			subject: translate(locale, 'mail.login.subject'),
			text: translate(locale, 'mail.login.text', { link }),
			to,
		});
	} catch (error) {
		logSendFailure(error);
	}
}

/**
 * Opens the login link window of an address, unless one was opened within the last
 * `LOGIN_LINK_WINDOW_SECONDS`. One atomic statement on the database clock, so it holds across
 * isolates and concurrent requests. Requests inside an open window do not extend it.
 *
 * @param db The database.
 * @param emailHash The HMAC of the normalized address.
 * @returns True when this request opened the window.
 */
async function openLoginLinkWindow(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
	db: Db,
	emailHash: string,
): Promise<boolean> {
	const opened = await db
		.insert(loginLinkWindow)
		.values({ emailHash, openedAt: sql`now()` })
		.onConflictDoUpdate({
			set: { openedAt: sql`excluded.opened_at` },
			setWhere: sql`${loginLinkWindow.openedAt} <= now() - make_interval(secs => ${LOGIN_LINK_WINDOW_SECONDS})`,
			target: loginLinkWindow.emailHash,
		})
		.returning({ emailHash: loginLinkWindow.emailHash });
	return opened.length > 0;
}

/**
 * Builds the `sendMagicLink` callback. It sends only when the request opened the login link
 * window of the address and the user exists and is not disabled, in the user's stored language.
 * Every request runs the same two statements (window upsert, user lookup), whether the address
 * is invited or not, and the mail goes out after the response, so neither the result nor the
 * response time tells which addresses are invited.
 *
 * @param deps The dependencies of the auth instance.
 * @param deps.db The database.
 * @param deps.mailer The mailer for login links.
 * @param deps.runInBackground Runs the sending after the response.
 * @param windowKey The HMAC key for the login link windows.
 * @returns The callback for the magic link plugin.
 */
function createLinkSender(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
	{ db, mailer, runInBackground = runDetached }: Readonly<AuthDeps>,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- CryptoKey is an opaque DOM handle
	windowKey: CryptoKey,
): (data: Readonly<{ email: string; url: string }>) => Promise<void> {
	return async ({ email, url }) => {
		const to = normalizeEmail(email);
		const emailHash = await hashLoginWindowEmail(windowKey, to);
		const [openedWindow, found] = await Promise.all([
			openLoginLinkWindow(db, emailHash),
			findUserByEmail(db, to),
		]);
		if (!openedWindow || found === null || found.status === 'disabled') return;
		// The mail touches no database, so it may outlive the request's pool (Cloudflare).
		runInBackground(sendLoginLink(mailer, { link: url, locale: found.locale, to }));
	};
}

/**
 * The Microsoft provider, when configured: limited to the club's tenant and without sign-up. An
 * invited user is linked by the verified e-mail address the tenant reports.
 *
 * @param microsoftLogin The Microsoft settings, or null when Microsoft login is off.
 * @returns The social providers for Better Auth.
 */
function socialProviders(microsoftLogin: Readonly<Env['microsoftLogin']>): SocialProviders {
	if (microsoftLogin === null) return {};
	return {
		microsoft: {
			clientId: microsoftLogin.clientId,
			clientSecret: microsoftLogin.clientSecret,
			disableImplicitSignUp: true,
			// The app shows no avatars, so skip the Graph request for the photo.
			disableProfilePhoto: true,
			disableSignUp: true,
			tenantId: microsoftLogin.tenantId,
		},
	};
}

// The instance type is inferred from these options; `Auth` is derived from this function.
// oxlint-disable-next-line typescript/explicit-function-return-type, typescript/prefer-readonly-parameter-types -- see above; Drizzle clients are mutable
function buildAuth(deps: Readonly<AuthDeps>, secret: string, windowKey: CryptoKey) {
	const { db, env } = deps;
	return betterAuth({
		account: {
			accountLinking: {
				enabled: true,
				// Users exist only by invitation of an admin, so the stored address is trusted even
				// before its first sign-in; the provider must still report the address as verified.
				requireLocalEmailVerified: false,
			},
		},
		advanced: { ipAddress: { ipAddressHeaders: IP_ADDRESS_HEADERS } },
		baseURL: env.appUrl.origin,
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: { account, rateLimit, session, user, verification },
		}),
		databaseHooks: {
			session: {
				create: {
					// The first session of an invited user activates the user.
					// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the hook signature is Better Auth's
					async after(created) {
						await activateInvitedUser(db, created.userId);
					},
					// Disabled users get no session, whatever the way they sign in.
					// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the hook signature is Better Auth's
					async before(data) {
						const found = await findUserById(db, data.userId);
						return found !== null && found.status !== 'disabled';
					},
				},
			},
			// No sign-up anywhere: users are created by the app (setup, invitation), never by Better Auth.
			// oxlint-disable-next-line typescript/require-await -- the hook type is async, refusing needs no I/O
			user: { create: { before: async () => false } },
		},
		disabledPaths: DISABLED_PATHS,
		emailAndPassword: { enabled: false },
		plugins: [
			magicLink({
				disableSignUp: true,
				expiresIn: LOGIN_LINK_TTL_SECONDS,
				sendMagicLink: createLinkSender(deps, windowKey),
				storeToken: 'hashed',
			}),
			// Must stay last: forwards cookies of server-side calls (session refresh) to the response.
			tanstackStartCookies(),
		],
		// In every environment, stored in the database so all isolates share the counters.
		rateLimit: {
			customRules: {
				'/sign-in/magic-link': {
					max: LINK_REQUESTS_PER_WINDOW,
					window: LINK_REQUEST_WINDOW_SECONDS,
				},
			},
			enabled: true,
			storage: 'database',
		},
		secret,
		session: { expiresIn: SESSION_TTL_SECONDS, updateAge: SESSION_REFRESH_AGE_SECONDS },
		socialProviders: socialProviders(env.microsoftLogin),
		telemetry: { enabled: false },
		user: {
			additionalFields: {
				isAdmin: { defaultValue: false, input: false, required: true, type: 'boolean' },
				status: { defaultValue: 'invited', input: false, required: true, type: 'string' },
			},
		},
	});
}

type Auth = ReturnType<typeof buildAuth>;

/**
 * Creates the Better Auth instance: login links by mail, optionally Microsoft, no passwords and
 * no sign-up.
 *
 * @param deps The database, the environment, the mailer for login links and the runner that
 *   sends them after the response.
 * @returns The auth instance.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
async function createAuth(deps: Readonly<AuthDeps>): Promise<Auth> {
	const [secret, windowKey] = await Promise.all([
		deriveAuthSecret(deps.env.appSecret),
		deriveLoginWindowKey(deps.env.appSecret),
	]);
	return buildAuth(deps, secret, windowKey);
}

/**
 * Requests a login link. Resolves the same way for invited, unknown and disabled addresses.
 *
 * @param auth The auth instance.
 * @param email The address as typed.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the Better Auth instance is mutable
async function requestLoginLink(auth: Auth, email: string): Promise<void> {
	await auth.api.signInMagicLink({
		body: {
			callbackURL: AFTER_SIGN_IN_PATH,
			email: normalizeEmail(email),
			errorCallbackURL: LOGIN_PATH,
		},
		headers: new Headers(),
	});
}

/**
 * Checks a login link and opens a session.
 *
 * @param auth The auth instance.
 * @param token The token of the link.
 * @returns The user id and the `Set-Cookie` header of the new session.
 * @throws {LoginLinkInvalidError} When the link is unknown, expired, used or its user is disabled.
 */
async function verifyLoginLink(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the Better Auth instance is mutable
	auth: Auth,
	token: string,
): Promise<{ userId: string; setCookie: string }> {
	try {
		const { headers, response } = await auth.api.magicLinkVerify({
			headers: new Headers(),
			query: { token },
			returnHeaders: true,
		});
		const setCookie = headers.get('set-cookie');
		if (setCookie === null) throw new LoginLinkInvalidError();
		return { setCookie, userId: response.user.id };
	} catch (error) {
		// Without a callback URL every rejection of the link is an APIError (a redirect with
		// `?error=`); anything else is a real failure and is rethrown.
		if (isAPIError(error)) throw new LoginLinkInvalidError();
		throw error;
	}
}

export { LoginLinkInvalidError, createAuth, requestLoginLink, verifyLoginLink };
export type { Auth, BackgroundRunner };
