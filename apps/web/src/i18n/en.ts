import type { de } from './de';

/**
 * All English UI texts: exactly the keys of `de`, with the same `{name}` parameters. A missing
 * or extra key fails the type check.
 */
export const en: Record<keyof typeof de, string> = {
	'a11y.skipLink': 'Skip to content',
	'app.name': 'Vereinsbote',
	'auth.emailLabel': 'Email',
	'auth.linkSent': 'We have sent a sign-in link to {email} if the address has been invited.',
	'auth.microsoft': 'Sign in with Microsoft',
	'auth.requestFailed': 'That did not work. Please try again.',
	'auth.requestLink': 'Request sign-in link',
	'auth.signInFailed':
		'Signing in did not work. The link is invalid, expired or already used. Request a new one.',
	'auth.title': 'Sign in',
	'auth.tooManyRequests': 'Too many requests. Please wait a minute and try again.',
	// Each language is named in its own language, in both files (the switcher sets `lang`).
	'language.de': 'Deutsch',
	'language.en': 'English',
	'language.label': 'Language',
	'mail.login.subject': 'Your sign-in link for Vereinsbote',
	'mail.login.text':
		'Hello,\n\nhere is your sign-in link:\n{link}\n\nThe link is valid for 15 minutes and works once.',
	'setup.disabled': 'Setup is not enabled. Set SETUP_TOKEN.',
	'setup.done': 'Setup is complete.',
	'setup.emailInvalid': 'Please enter a valid email address.',
	'setup.emailLabel': 'Email',
	'setup.nameInvalid': 'Please enter a name.',
	'setup.nameLabel': 'Name',
	'setup.submit': 'Complete setup',
	'setup.title': 'First-time setup',
	'setup.toLogin': 'Go to sign-in',
	'setup.tokenInvalid': 'The setup token is not correct.',
	'setup.tokenLabel': 'Setup token',
};
