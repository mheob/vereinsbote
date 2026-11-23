import { createRootRoute, HeadContent, Scripts, useLoaderData } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';

import { PageFrame } from '@/components/page-frame';
import { DEFAULT_LOCALE } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { LocaleProvider } from '@/i18n/use-t';

import appCss from '@/styles.css?url';

/**
 * Resolves the language of the request on the server: the `locale` cookie, then
 * `Accept-Language`, then German. A server function reads the request headers during SSR and on
 * client navigation alike; the server module is imported inside the handler, so it stays out of
 * the client bundle.
 */
const loadLocale = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ getRequest }, { getRequestLocale }] = await Promise.all([
		import('@tanstack/react-start/server'),
		import('@/server/i18n/request-locale'),
	]);
	return { locale: getRequestLocale(getRequest().headers) };
});

export const Route = createRootRoute({
	head: ({ loaderData }) => ({
		links: [{ href: appCss, rel: 'stylesheet' }],
		meta: [
			// oxlint-disable-next-line unicorn/text-encoding-identifier-case -- HTML only allows the label "utf-8".
			{ charSet: 'utf-8' },
			{ content: 'width=device-width, initial-scale=1', name: 'viewport' },
			{ title: translate(loaderData?.locale ?? DEFAULT_LOCALE, 'app.name') },
		],
	}),
	// Loader data is part of the SSR payload, so hydration renders the language the server chose.
	loader: async () => loadLocale(),
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above; ReactNode cannot be made deeply readonly
	shellComponent: function RootShell({ children }: Readonly<{ children: ReactNode }>): ReactNode {
		const { locale } = useLoaderData({ from: '__root__' });
		return (
			<html lang={locale}>
				<head>
					<HeadContent />
				</head>
				<body>
					<LocaleProvider locale={locale}>
						<PageFrame>{children}</PageFrame>
					</LocaleProvider>
					<Scripts />
				</body>
			</html>
		);
	},
	// The language changes only through the language switcher, which reloads the page; client
	// navigation keeps the loaded locale instead of asking the server again.
	staleTime: Number.POSITIVE_INFINITY,
});
