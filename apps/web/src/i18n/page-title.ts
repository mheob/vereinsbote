import { DEFAULT_LOCALE, isLocale } from './locale';
import type { Locale } from './locale';
import { translate } from './translate';
import type { MessageKey } from './translate';

/** The part of a route match the title depends on. */
interface TitleMatch {
	readonly status: string;
	readonly _notFound?: boolean;
}

/** The part of TanStack Router's `head` context the title depends on. */
interface TitleContext {
	/** The route's own match. */
	readonly match: TitleMatch;
	/** All matches of the page; the first is the root, whose loader resolved the locale. */
	readonly matches: readonly Readonly<{ loaderData?: unknown }>[];
}

/**
 * The language of the request, which the root loader resolved (`{ locale }`).
 *
 * @param matches The matches of the page, root first.
 * @returns The locale, or German when the root loader has none (it failed).
 */
function requestLocale(matches: TitleContext['matches']): Locale {
	const data = matches[0]?.loaderData;
	const locale: unknown =
		typeof data === 'object' && data !== null && 'locale' in data ? data.locale : undefined;
	return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * The page the title names: the route's own, or the error or not-found page that replaces it.
 *
 * @param match The route's match.
 * @param page The key of the page's name, or null for a route without a name of its own.
 * @returns The key of the shown page's name, or null.
 */
function shownPage(match: TitleMatch, page: MessageKey | null): MessageKey | null {
	if (match.status === 'error') return 'error.title';
	// oxlint-disable-next-line no-underscore-dangle -- TanStack Router's flag of the not-found boundary
	if (match.status === 'notFound' || match._notFound === true) return 'notFound.title';
	return page;
}

/**
 * The `head` of a route: the document title „{page} – Vereinsbote“ in the language of the request,
 * so every page has a title of its own (WCAG 2.4.2). The deepest route's title wins. A route that
 * failed or was not found is named as the error or not-found page that the router shows instead.
 *
 * @param context The `head` context of the route.
 * @param page The key of the page's name; null names the app only.
 * @returns The head with the title.
 */
function pageHead(context: TitleContext, page: MessageKey | null): { meta: [{ title: string }] } {
	const locale = requestLocale(context.matches);
	const shown = shownPage(context.match, page);
	const title =
		shown === null
			? translate(locale, 'app.name')
			: translate(locale, 'app.pageTitle', { page: translate(locale, shown) });
	return { meta: [{ title }] };
}

/** The `head` context of an admin page, whose route context says whether the user is an admin. */
type AdminTitleContext = TitleContext & {
	readonly match: TitleMatch & { readonly context: Readonly<{ isAdmin: boolean }> };
};

/**
 * The `head` of an admin page: its own title for admins, the one of "no access" for everybody
 * else (the admin layout shows that page instead). Routes annotate the context with
 * `AdminTitleContext`: their loader reads the route context too, and an unannotated `head` would
 * keep TypeScript from inferring the loader's data.
 *
 * @param context The `head` context of the route.
 * @param page The key of the page's name.
 * @returns The head with the title.
 */
function adminPageHead(
	context: AdminTitleContext,
	page: MessageKey,
): { meta: [{ title: string }] } {
	return pageHead(context, context.match.context.isAdmin ? page : 'admin.forbidden');
}

export { adminPageHead, pageHead };
export type { AdminTitleContext };
