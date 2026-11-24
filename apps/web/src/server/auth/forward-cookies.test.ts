import { describe, expect, it } from 'vite-plus/test';

import { forwardSetCookie } from './forward-cookies';
import type { ResponseCookies } from './forward-cookies';

const SESSION =
	'__Secure-better-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax';
const DATA = 'better-auth.session_data=xyz; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/';

/**
 * A response that keeps what is appended, like TanStack Start's response headers.
 *
 * @returns The response and the cookies it holds.
 */
function keepingResponse(): ResponseCookies & { held: string[] } {
	const held: string[] = [];
	return {
		append(cookies) {
			held.push(...cookies);
		},
		current: () => [...held],
		held,
	};
}

describe(forwardSetCookie, () => {
	it('puts every cookie of a combined Set-Cookie header on the response', () => {
		const response = keepingResponse();
		forwardSetCookie(`${SESSION}, ${DATA}`, response);
		expect(response.held).toStrictEqual([SESSION, DATA]);
	});

	it('throws when the response does not keep a cookie, without naming its value', () => {
		const dropping: ResponseCookies = {
			append() {
				// Drops the cookies, as a response that cannot take headers any more.
			},
			current: () => [],
		};
		expect(() => {
			forwardSetCookie(SESSION, dropping);
		}).toThrow('The session cookie is not on the response.');
		expect(() => {
			forwardSetCookie(SESSION, dropping);
		}).not.toThrow(/abc/u);
	});

	it('throws for an empty header', () => {
		expect(() => {
			forwardSetCookie('', keepingResponse());
		}).toThrow('The session cookie is not on the response.');
	});
});
