import { describe, expect, it } from 'vite-plus/test';

import { getRequestLocale } from './request-locale';

describe(getRequestLocale, () => {
	it('takes the locale cookie first', () => {
		const headers = new Headers({
			'accept-language': 'de-DE',
			cookie: 'better-auth.session_token=abc; locale=en; theme=dark',
		});
		expect(getRequestLocale(headers)).toBe('en');
	});

	it('falls back to Accept-Language without a valid locale cookie', () => {
		expect(getRequestLocale(new Headers({ 'accept-language': 'en-GB' }))).toBe('en');
		expect(getRequestLocale(new Headers({ 'accept-language': 'en-GB', cookie: 'locale=fr' }))).toBe(
			'en',
		);
		// Only the cookie named exactly `locale` counts.
		expect(
			getRequestLocale(new Headers({ 'accept-language': 'en', cookie: 'xlocale=de; locale_x=de' })),
		).toBe('en');
	});

	it('falls back to German without cookie and Accept-Language', () => {
		expect(getRequestLocale(new Headers())).toBe('de');
	});
});
