import { describe, expect, it } from 'vite-plus/test';

import { signInErrorMessage } from './sign-in-error';

describe(signInErrorMessage, () => {
	it('says that a Microsoft account is not invited', () => {
		expect(signInErrorMessage('signup_disabled')).toBe('auth.microsoftNotInvited');
		expect(signInErrorMessage('account_not_linked')).toBe('auth.microsoftNotInvited');
	});

	it('keeps the general message for every other failure', () => {
		expect(signInErrorMessage('INVALID_TOKEN')).toBe('auth.signInFailed');
		expect(signInErrorMessage('state_mismatch')).toBe('auth.signInFailed');
		expect(signInErrorMessage('')).toBe('auth.signInFailed');
	});
});
