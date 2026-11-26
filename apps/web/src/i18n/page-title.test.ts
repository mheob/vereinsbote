import { describe, expect, it } from 'vite-plus/test';

import { contactsPageHead, pageHead } from './page-title';
import type { ContactsTitleContext } from './page-title';

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

	it('names the own not-found page of a route that has one', () => {
		const own = { notFound: 'auth.confirmTitle' } as const;
		expect(pageHead(context('de', { status: 'notFound' }), 'auth.title', own).meta[0].title).toBe(
			'Anmeldung bestätigen – Vereinsbote',
		);
		expect(pageHead(context('de'), 'auth.title', own).meta[0].title).toBe('Anmelden – Vereinsbote');
		expect(pageHead(context('de', { status: 'error' }), 'auth.title', own).meta[0].title).toBe(
			'Ein Fehler ist aufgetreten – Vereinsbote',
		);
	});

	it('falls back to German when the root loader has no locale', () => {
		expect(pageHead(context(undefined, { status: 'error' }), null).meta[0].title).toBe(
			'Ein Fehler ist aufgetreten – Vereinsbote',
		);
		expect(pageHead(context('fr'), 'auth.title').meta[0].title).toBe('Anmelden – Vereinsbote');
	});
});

/**
 * The head context of a contacts page whose layout loaded the user's access.
 *
 * @param access What the user may do with contacts.
 * @param access.canList Whether the user sees the list.
 * @param access.canManage Whether the user manages members and partners.
 * @returns The context.
 */
function contactsContext(
	access: Readonly<{
		canList: boolean;
		canManage: Readonly<{ member: boolean; partner: boolean }>;
	}>,
): ContactsTitleContext {
	return {
		match: { context: { access }, status: 'success' },
		matches: [{ loaderData: { locale: 'de' } }],
	};
}

describe(contactsPageHead, () => {
	it('names a contacts page as no access without the needed right', () => {
		const reader = { canList: true, canManage: { member: false, partner: false } };
		expect(
			contactsPageHead(
				contactsContext({ canList: false, canManage: { member: false, partner: false } }),
				'contacts.title',
			).meta[0].title,
		).toBe('Kein Zugriff – Vereinsbote');
		expect(
			contactsPageHead(contactsContext(reader), 'contacts.title', 'partner').meta[0].title,
		).toBe('Kein Zugriff – Vereinsbote');
		expect(contactsPageHead(contactsContext(reader), 'contacts.title').meta[0].title).toBe(
			'Kontakte – Vereinsbote',
		);
		const partnerEditor = { canList: true, canManage: { member: false, partner: true } };
		expect(
			contactsPageHead(contactsContext(partnerEditor), 'contacts.title', 'partner').meta[0].title,
		).toBe('Kontakte – Vereinsbote');
		expect(
			contactsPageHead(contactsContext(partnerEditor), 'contacts.title', 'member').meta[0].title,
		).toBe('Kein Zugriff – Vereinsbote');
	});
});
