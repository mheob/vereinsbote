import type { MessageKey } from '@/i18n/translate';

/**
 * The codes Better Auth puts into `?error=` when a Microsoft account belongs to no invited user:
 * no user has its address (`signup_disabled`, sign-up is off), or the provider does not vouch for
 * the address (`account_not_linked`).
 */
const MICROSOFT_NOT_INVITED = new Set(['account_not_linked', 'signup_disabled']);

/**
 * The message of the sign-in page for a failed sign-in, by the code Better Auth sent back.
 *
 * @param code The value of `?error=`.
 * @returns The key of the message.
 */
function signInErrorMessage(code: string): MessageKey {
	return MICROSOFT_NOT_INVITED.has(code) ? 'auth.microsoftNotInvited' : 'auth.signInFailed';
}

export { signInErrorMessage };
