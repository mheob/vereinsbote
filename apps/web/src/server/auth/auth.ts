import { betterAuth } from 'better-auth';
import type { SocialProviders } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { isAPIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';
import { tanstackStartCookies } from 'better-auth/tanstack-start';

import { t } from '../../i18n/t';
import { deriveAuthSecret } from '../crypto/secrets';
import type { Db } from '../db/client';
import { account, session, user, verification } from '../db/schema';
import type { Env } from '../env';
import type { SystemMailer } from '../mail/system-mailer';
import { activateInvitedUser, findUserByEmail, findUserById } from '../users/repo';
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

interface AuthDeps {
	db: Db;
	env: Env;
	mailer: SystemMailer;
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
 * Builds the `sendMagicLink` callback. It sends only to a user who exists and is not disabled.
 * Unknown and disabled addresses get nothing, and a failing mailer is only logged, so the caller
 * sees the same result in every case and cannot tell which addresses are invited.
 *
 * @param deps The dependencies of the auth instance.
 * @param deps.db The database.
 * @param deps.mailer The mailer for login links.
 * @returns The callback for the magic link plugin.
 */
function createLinkSender(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
	{ db, mailer }: Readonly<AuthDeps>,
): (data: Readonly<{ email: string; url: string }>) => Promise<void> {
	return async ({ email, url }) => {
		const to = normalizeEmail(email);
		const found = await findUserByEmail(db, to);
		if (found === null || found.status === 'disabled') return;
		try {
			await mailer.send({
				subject: t('mail.login.subject'),
				text: t('mail.login.text', { link: url }),
				to,
			});
		} catch (error) {
			logSendFailure(error);
		}
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
function buildAuth(deps: Readonly<AuthDeps>, secret: string) {
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
		baseURL: env.appUrl.origin,
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: { account, session, user, verification },
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
		emailAndPassword: { enabled: false },
		plugins: [
			magicLink({
				disableSignUp: true,
				expiresIn: LOGIN_LINK_TTL_SECONDS,
				sendMagicLink: createLinkSender(deps),
			}),
			// Must stay last: forwards cookies of server-side calls (session refresh) to the response.
			tanstackStartCookies(),
		],
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
 * @param deps The database, the environment and the mailer for login links.
 * @returns The auth instance.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
async function createAuth(deps: Readonly<AuthDeps>): Promise<Auth> {
	return buildAuth(deps, await deriveAuthSecret(deps.env.appSecret));
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
export type { Auth };
