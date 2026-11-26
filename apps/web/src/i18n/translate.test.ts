import { describe, expect, it } from 'vite-plus/test';

import { de } from './de';
import { en } from './en';
import type { MessageKey, MessageParams } from './translate';
import { translate } from './translate';

const PLACEHOLDER = /\{\w+\}/gu;

/**
 * The `{name}` placeholders of a text, sorted.
 *
 * @param text The text.
 * @returns The placeholders, braces included.
 */
function placeholders(text: string): string[] {
	return (text.match(PLACEHOLDER) ?? []).toSorted();
}

describe(translate, () => {
	it('translates per locale', () => {
		expect(translate('de', 'a11y.skipLink')).toBe('Zum Inhalt springen');
		expect(translate('en', 'a11y.skipLink')).toBe('Skip to content');
	});

	it('interpolates and names missing params in both locales', () => {
		expect(translate('en', 'auth.linkSent', { email: 'kim@v.de' })).toBe(
			'We have sent a sign-in link to kim@v.de if the address has been invited.',
		);
		expect(() => translate('de', 'auth.linkSent')).toThrow(/email/u);
		expect(() => translate('en', 'auth.linkSent')).toThrow(/email/u);
	});

	it('interpolates numbers', () => {
		expect(translate('de', 'auth.linkSent', { email: 42 })).toBe(
			'Wir haben einen Anmeldelink an 42 geschickt, falls die Adresse eingeladen ist.',
		);
	});

	it('does not take params from the prototype chain', () => {
		// oxlint-disable-next-line typescript/no-unsafe-assignment -- Object.create returns any; the param must sit on the prototype
		const inherited: MessageParams = Object.create({ email: 'kim@v.de' });
		expect(() => translate('en', 'auth.linkSent', inherited)).toThrow(/email/u);
	});

	it('keeps the fixed English texts', () => {
		expect({
			appName: translate('en', 'app.name'),
			emailLabel: translate('en', 'auth.emailLabel'),
			loginSubject: translate('en', 'mail.system.login.subject'),
			microsoft: translate('en', 'auth.microsoft'),
			requestLink: translate('en', 'auth.requestLink'),
			staleText: translate('en', 'mail.system.staleImport.text', { date: 'June 1, 2026' }),
			tooManyRequests: translate('en', 'auth.tooManyRequests'),
		}).toStrictEqual({
			appName: 'Vereinsbote',
			emailLabel: 'Email',
			loginSubject: 'Your sign-in link for Vereinsbote',
			microsoft: 'Sign in with Microsoft',
			requestLink: 'Request sign-in link',
			staleText: 'the last member import was on June 1, 2026. Please upload a current export.',
			tooManyRequests: 'Too many requests. Please wait a minute and try again.',
		});
		expect(translate('de', 'app.name')).toBe('Vereinsbote');
		expect(translate('de', 'auth.tooManyRequests')).toBe(
			'Zu viele Anfragen. Bitte warte eine Minute und versuche es dann erneut.',
		);
	});

	it('names each language in its own language', () => {
		for (const locale of ['de', 'en'] as const) {
			expect(translate(locale, 'language.de')).toBe('Deutsch');
			expect(translate(locale, 'language.en')).toBe('English');
		}
	});

	it('uses the same placeholders in de and en for every key', () => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.keys loses the key type of `de`
		const keys = Object.keys(de) as MessageKey[];
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) {
			expect({ key, placeholders: placeholders(en[key]) }).toStrictEqual({
				key,
				placeholders: placeholders(de[key]),
			});
		}
	});

	it('has an English text for every key and no other', () => {
		expect(Object.keys(en).toSorted()).toStrictEqual(Object.keys(de).toSorted());
		expect(Object.values(en).filter((text) => text.trim() === '')).toStrictEqual([]);
	});
});
