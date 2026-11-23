import { LOCALE_COOKIE, resolveLocale } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';

/**
 * Reads one cookie from a `Cookie` header.
 *
 * @param cookieHeader The `Cookie` header, or null without one.
 * @param name The cookie name.
 * @returns The value of the first cookie with that name, or null.
 */
function readCookie(cookieHeader: string | null, name: string): string | null {
	if (cookieHeader === null) return null;
	for (const pair of cookieHeader.split(';')) {
		const [cookieName = '', ...value] = pair.split('=');
		if (value.length > 0 && cookieName.trim() === name) return value.join('=').trim();
	}
	return null;
}

/**
 * The language of a request: the `locale` cookie, then `Accept-Language`, then German.
 *
 * @param headers The request headers.
 * @returns The locale.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Headers cannot be made readonly
function getRequestLocale(headers: Headers): Locale {
	return resolveLocale({
		acceptLanguage: headers.get('accept-language'),
		cookie: readCookie(headers.get('cookie'), LOCALE_COOKIE),
	});
}

export { getRequestLocale };
