import { betterAuth } from 'better-auth';
import type { BetterAuthOptions, SocialProviders } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { isAPIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { AFTER_SIGN_IN_PATH, LOGIN_PATH } from '@/paths';
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
import { errorLabel, errorLabelWithCause } from '@/server/error-label';
import type { SystemMailer } from '@/server/mail/system-mailer';
import { closeSetupRecoveryFor } from '@/server/setup/setup';
import { findUserByEmail, findUserById, recordSignIn } from '@/server/users/repo';

import { normalizeEmail } from './email';
import { isServerOpenedSession, sessionForUser } from './session-for-user';
import {
	LINK_REQUEST_WINDOW_SECONDS,
	LINK_REQUESTS_PER_WINDOW,
	LOGIN_LINK_WINDOW_SECONDS,
} from './sign-in-limits';

/** 15 minutes. */
const LOGIN_LINK_TTL_SECONDS = 900;
/** 7 days. */
const SESSION_TTL_SECONDS = 604_800;
/** 1 day: a session used after this age gets a fresh `SESSION_TTL_SECONDS` (sliding expiry). */
const SESSION_REFRESH_AGE_SECONDS = 86_400;
const HTTP_INTERNAL_SERVER_ERROR = 500;

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
 * `/magic-link/verify`, `/sign-in/social`, `/callback/:id` (Microsoft), `/sign-out`, `/ok` and
 * `/error`. `/get-session` is off as well: the app reads sessions on the server
 * (`auth.api.getSession`), so the browser needs no endpoint that returns the session and user.
 * A test keeps this list complete for new Better Auth versions.
 */
const DISABLED_PATHS = [
	'/account-info',
	'/change-email',
	'/change-password',
	'/delete-user',
	'/delete-user/callback',
	'/get-access-token',
	'/get-session',
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

/** The message of `createSessionFor` when the user gets no session. */
const SESSION_NOT_CREATED = 'No session was opened for the user.';

/** Keeps a promise running after the response, like `waitUntil`. */
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
	// oxlint-disable-next-line no-console -- the only trace of a login link that never arrives
	console.error('login link not sent', errorLabel(error));
}

type AuthLogLevel = Parameters<NonNullable<NonNullable<BetterAuthOptions['logger']>['log']>>[0];

/**
 * Better Auth's log output, at its own level (`warn` and above). Its messages may carry request
 * values (origins, redirect URLs), and its arguments are often database errors whose message
 * lists the query and its parameters (session tokens, user ids, addresses). So neither goes out:
 * only the level and the code or name of each argument (`errorLabelWithCause`).
 *
 * @param level The level of the entry.
 * @param _message Better Auth's message, never logged.
 * @param args The values Better Auth logs with it, logged by code or name only.
 */
function logAuthEvent(level: AuthLogLevel, _message: string, ...args: readonly unknown[]): void {
	const labels = args.map((arg) => errorLabelWithCause(arg));
	/* oxlint-disable no-console -- Better Auth's events, reduced to their codes */
	if (level === 'error') console.error('better auth', level, ...labels);
	else if (level === 'warn') console.warn('better auth', level, ...labels);
	else console.info('better auth', level, ...labels);
	/* oxlint-enable no-console */
}

/**
 * Default background runner: lets the promise finish on its own, which a Node process allows.
 *
 * @param promise The work to finish after the response.
 */
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
async function openLoginLinkWindow(db: Db, emailHash: string): Promise<boolean> {
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
	{ db, mailer, runInBackground = runDetached }: AuthDeps,
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
// oxlint-disable-next-line typescript/explicit-function-return-type -- see above; Drizzle clients are mutable
function buildAuth(deps: AuthDeps, secret: string, windowKey: CryptoKey) {
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
					// The first session of a user activates an invited one and is kept as the first
					// sign-in. A sign-in of the setup admin closes the setup's recovery; the setup's own
					// session does not, its route does so once the cookie is on the response.
					async after(created, context) {
						await recordSignIn(db, created.userId);
						if (!isServerOpenedSession(context)) {
							await closeSetupRecoveryFor(db, created.userId);
						}
					},
					// Disabled users get no session, whatever the way they sign in.
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
		logger: { level: 'warn', log: logAuthEvent },
		// Unexpected errors leave the HTTP handler instead of being printed whole by Better Auth's
		// router; `handleAuthRequest` logs them by code. API errors (4xx) stay responses.
		onAPIError: { throw: true },
		plugins: [
			magicLink({
				disableSignUp: true,
				expiresIn: LOGIN_LINK_TTL_SECONDS,
				sendMagicLink: createLinkSender(deps, windowKey),
				storeToken: 'hashed',
			}),
			sessionForUser,
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
async function createAuth(deps: AuthDeps): Promise<Auth> {
	const [secret, windowKey] = await Promise.all([
		deriveAuthSecret(deps.env.appSecret),
		deriveLoginWindowKey(deps.env.appSecret),
	]);
	return buildAuth(deps, secret, windowKey);
}

/**
 * Hands an HTTP request under `/api/auth/` to Better Auth. An unexpected failure is logged by
 * code only and answered with a bare 500: the error of a failed query lists the query and its
 * parameters (session tokens, addresses), which Better Auth's router would print whole. A 5xx
 * response of Better Auth itself is logged by its status only, never its body.
 *
 * @param auth The auth instance (its HTTP handler).
 * @param request The request.
 * @returns Better Auth's response, or 500.
 */
async function handleAuthRequest(auth: Pick<Auth, 'handler'>, request: Request): Promise<Response> {
	try {
		const response = await auth.handler(request);
		if (response.status >= HTTP_INTERNAL_SERVER_ERROR) {
			// oxlint-disable-next-line no-console -- the status only, the body may carry details
			console.error(`better auth HTTP ${response.status}`);
		}
		return response;
	} catch (error) {
		// oxlint-disable-next-line no-console -- code or name only, see above
		console.error('auth request failed', errorLabelWithCause(error));
		return new Response(null, { status: HTTP_INTERNAL_SERVER_ERROR });
	}
}

/**
 * Requests a login link. Resolves the same way for invited, unknown and disabled addresses.
 *
 * @param auth The auth instance.
 * @param email The address as typed.
 */
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

/**
 * Opens a session for a user without a login link, for a user the app has identified itself (the
 * first admin, right after the setup). Inside a TanStack Start request the `tanstackStartCookies`
 * plugin also puts the cookie on the response. On Cloudflare, pass the request's auth instance.
 *
 * @param auth The auth instance.
 * @param userId The id of the user.
 * @returns The `Set-Cookie` header of the new session.
 * @throws {Error} `SESSION_NOT_CREATED` when the user is unknown or disabled.
 */
async function createSessionFor(auth: Auth, userId: string): Promise<{ setCookie: string }> {
	let setCookie: string | null = null;
	try {
		const { headers } = await auth.api.createSessionForUser({
			body: { userId },
			returnHeaders: true,
		});
		setCookie = headers.get('set-cookie');
	} catch (error) {
		if (!isAPIError(error)) throw error;
	}
	if (setCookie === null) throw new Error(SESSION_NOT_CREATED);
	return { setCookie };
}

export {
	LoginLinkInvalidError,
	SESSION_NOT_CREATED,
	createAuth,
	createSessionFor,
	handleAuthRequest,
	requestLoginLink,
	verifyLoginLink,
};
export type { Auth, BackgroundRunner };
