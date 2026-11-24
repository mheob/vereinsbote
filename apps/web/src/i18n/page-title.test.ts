import { describe, expect, it } from 'vite-plus/test';

import { pageHead } from './page-title';

/**
 * A head context as TanStack Router passes it: the root match carries the request's locale.
 *
 * @param locale The locale of the root loader, or undefined when it failed.
 * @param match The status of the route's own match.
 * @returns The context.
 */
function context(
	locale: string | undefined,
	match?: Readonly<{ status: 'error' | 'notFound' | 'success'; _notFound?: boolean }>,
): Parameters<typeof pageHead>[0] {
	return {
		match: match ?? { status: 'success' },
		matches: [{ loaderData: locale === undefined ? undefined : { locale } }],
	};
}

describe(pageHead, () => {
	it('names the page and the app in the language of the request', () => {
		expect(pageHead(context('de'), 'auth.title')).toStrictEqual({
			meta: [{ title: 'Anmelden – Vereinsbote' }],
		});
		expect(pageHead(context('en'), 'auth.title')).toStrictEqual({
			meta: [{ title: 'Sign in – Vereinsbote' }],
		});
	});

	it('names the app only without a page', () => {
		expect(pageHead(context('en'), null).meta[0].title).toBe('Vereinsbote');
	});

	it('names the error page when the route failed', () => {
		expect(pageHead(context('de', { status: 'error' }), 'users.title').meta[0].title).toBe(
			'Ein Fehler ist aufgetreten – Vereinsbote',
		);
		expect(pageHead(context('en', { status: 'error' }), null).meta[0].title).toBe(
			'Something went wrong – Vereinsbote',
		);
	});

	it('names the not-found page for an unknown address', () => {
		expect(
			pageHead(context('en', { _notFound: true, status: 'success' }), null).meta[0].title,
		).toBe('Page not found – Vereinsbote');
		expect(pageHead(context('de', { status: 'notFound' }), 'home.title').meta[0].title).toBe(
			'Seite nicht gefunden – Vereinsbote',
		);
	});

	it('falls back to German when the root loader has no locale', () => {
		expect(pageHead(context(undefined, { status: 'error' }), null).meta[0].title).toBe(
			'Ein Fehler ist aufgetreten – Vereinsbote',
		);
		expect(pageHead(context('fr'), 'auth.title').meta[0].title).toBe('Anmelden – Vereinsbote');
	});
});
