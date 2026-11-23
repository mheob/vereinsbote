import { createContext, use, useCallback } from 'react';
import type { ReactNode } from 'react';

import { DEFAULT_LOCALE } from './locale';
import type { Locale } from './locale';
import { translate } from './translate';
import type { MessageKey, MessageParams } from './translate';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/**
 * Provides the language of the request to all components below. The root route renders it with
 * the locale the server resolved, so server render and hydration agree.
 *
 * @param props The provider's props.
 * @param props.locale The language.
 * @param props.children The components that read it.
 * @returns The provider.
 */
export function LocaleProvider({
	locale,
	children,
}: Readonly<{ locale: Locale; children: ReactNode }>): ReactNode {
	return <LocaleContext value={locale}>{children}</LocaleContext>;
}

/**
 * The language of the current request.
 *
 * @returns The locale of the nearest `LocaleProvider`.
 */
// oxlint-disable-next-line react/only-export-components -- the hooks belong to the provider (one i18n module)
export function useLocale(): Locale {
	return use(LocaleContext);
}

/**
 * Returns `translate` bound to the current language.
 *
 * @returns A function from key and parameters to the text.
 */
// oxlint-disable-next-line react/only-export-components -- see useLocale
export function useT(): (key: MessageKey, params?: MessageParams) => string {
	const locale = useLocale();
	return useCallback(
		(key: MessageKey, params?: MessageParams) => translate(locale, key, params),
		[locale],
	);
}
