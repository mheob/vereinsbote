import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_LOCALE, intlLocale, isLocale, resolveLocale, SUPPORTED_LOCALES } from './locale';

describe(resolveLocale, () => {
	it.each([
		[{ acceptLanguage: 'de-DE', cookie: 'en' }, 'en'],
		[{ acceptLanguage: 'en-GB,en;q=0.9', cookie: 'fr' }, 'en'],
		[{ acceptLanguage: 'fr-FR, de-AT;q=0.8, en;q=0.5', cookie: null }, 'de'],
		[{ acceptLanguage: 'fr-FR, en;q=0.9, de;q=0.8', cookie: null }, 'en'],
		[{ acceptLanguage: 'fr', cookie: null }, 'de'],
		[{ acceptLanguage: null, cookie: null }, 'de'],
	] as const)('resolveLocale(%o) is %s', (input, expected) => {
		expect(resolveLocale(input)).toBe(expected);
	});

	it.each([
		// Equal q-values keep the order of the header.
		['en;q=0.8, de;q=0.8', 'en'],
		// q=0 means "not acceptable".
		['en;q=0, de;q=0.1', 'de'],
		['en;q=0', 'de'],
		// Unreadable or out-of-range q-values are skipped.
		['en;q=abc, de;q=0.5', 'de'],
		['en;q=2, de;q=0.5', 'de'],
		// Case and whitespace do not matter, a wildcard picks nothing.
		['  EN-us ;Q=0.7 , *', 'en'],
		['*', 'de'],
		['', 'de'],
	] as const)('reads the Accept-Language header %j as %s', (acceptLanguage, expected) => {
		expect(resolveLocale({ acceptLanguage, cookie: null })).toBe(expected);
	});

	it('ignores a cookie that is not exactly a supported locale', () => {
		expect(resolveLocale({ acceptLanguage: 'en', cookie: 'DE' })).toBe('en');
		expect(resolveLocale({ acceptLanguage: 'en', cookie: '' })).toBe('en');
	});
});

describe(isLocale, () => {
	it('accepts the supported locales only', () => {
		expect(SUPPORTED_LOCALES.every((locale) => isLocale(locale))).toBe(true);
		const values = [DEFAULT_LOCALE, 'fr', 'de-DE', '', null, undefined, 1];
		expect(values.map((value) => isLocale(value))).toStrictEqual([
			true,
			false,
			false,
			false,
			false,
			false,
			false,
		]);
	});
});

describe(intlLocale, () => {
	it.each([
		['de', 'de-DE'],
		['en', 'en-US'],
	] as const)('formats %s with %s', (locale, expected) => {
		expect(intlLocale(locale)).toBe(expected);
	});
});
