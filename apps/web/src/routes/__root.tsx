import {
	createRootRoute,
	HeadContent,
	Scripts,
	useMatch,
	useRouteContext,
} from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';

import { PageFrame } from '@/components/page-frame';
import { DEFAULT_LOCALE } from '@/i18n/locale';
import { pageHead } from '@/i18n/page-title';
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

/**
 * Whether the request has a valid session, for the header's „Abmelden“. A failed check counts as
 * signed out and is logged by code: the pages check the session themselves, so the frame should
 * not turn every page into an error page.
 */
const loadViewer = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ getRequest }, { getAppContext }, { getSessionUser }, { errorLabelWithCause }] =
		await Promise.all([
			import('@tanstack/react-start/server'),
			import('@/platform/context'),
			import('@/server/auth/session'),
			import('@/server/error-label'),
		]);
	try {
		const { auth, db } = await getAppContext();
		return { signedIn: (await getSessionUser(auth, db, getRequest().headers)) !== null };
	} catch (error) {
		// oxlint-disable-next-line no-console -- code or name only, the message may carry details
		console.error('session check failed', errorLabelWithCause(error));
		return { signedIn: false };
	}
});

export const Route = createRootRoute({
	// Runs on every navigation, so the header follows a sign-in, the setup's redirect or a block.
	beforeLoad: async () => loadViewer(),
	head: (context) => ({
		links: [{ href: appCss, rel: 'stylesheet' }],
		meta: [
			// oxlint-disable-next-line unicorn/text-encoding-identifier-case -- HTML only allows the label "utf-8".
			{ charSet: 'utf-8' },
			{ content: 'width=device-width, initial-scale=1', name: 'viewport' },
			// The app's name; pages name themselves, and so do the error and not-found pages.
			...pageHead(context, null).meta,
		],
	}),
	// Loader data is part of the SSR payload, so hydration renders the language the server chose.
	loader: async () => loadLocale(),
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above; ReactNode cannot be made deeply readonly
	shellComponent: function RootShell({ children }: Readonly<{ children: ReactNode }>): ReactNode {
		// Without loader data (the root loader failed) the error page still renders, in German.
		const locale =
			useMatch({ from: '__root__', select: (match) => match.loaderData?.locale }) ?? DEFAULT_LOCALE;
		const signedIn = useRouteContext({ from: '__root__', select: (context) => context.signedIn });
		return (
			<html lang={locale}>
				<head>
					<HeadContent />
				</head>
				<body>
					<LocaleProvider locale={locale}>
						<PageFrame signedIn={signedIn}>{children}</PageFrame>
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
