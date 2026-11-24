import { splitSetCookieHeader } from 'better-auth/cookies';

/** The `Set-Cookie` values of the response being built. */
interface ResponseCookies {
	/** Adds cookies; a cookie with the same name and path replaces an earlier one. */
	append: (cookies: readonly string[]) => void;
	/** The `Set-Cookie` values the response holds now. */
	current: () => readonly string[];
}

/**
 * The name of the cookie in a `Set-Cookie` value.
 *
 * @param setCookie One `Set-Cookie` value.
 * @returns The cookie name.
 */
function cookieName(setCookie: string): string {
	return setCookie.slice(0, setCookie.indexOf('=')).trim();
}

/**
 * Puts the cookies of a `Set-Cookie` header on the response and checks that they are there. A
 * session whose cookie never reaches the browser counts as not opened.
 *
 * @param setCookie The `Set-Cookie` header, several cookies joined by commas.
 * @param response The response being built.
 * @throws {Error} When the header has no cookie or the response does not hold one of them; the
 *   message names no cookie value.
 */
function forwardSetCookie(setCookie: string, response: Readonly<ResponseCookies>): void {
	const cookies = splitSetCookieHeader(setCookie);
	response.append(cookies);
	const held = new Set(response.current().map((cookie) => cookieName(cookie)));
	if (cookies.length === 0 || !cookies.every((cookie) => held.has(cookieName(cookie)))) {
		throw new Error('The session cookie is not on the response.');
	}
}

export { forwardSetCookie };
export type { ResponseCookies };
