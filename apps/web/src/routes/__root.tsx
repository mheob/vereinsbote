import { createRootRoute, HeadContent, Scripts, useMatch, useRouter } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { RouterProvider } from 'react-aria-components';

import { PageFrame } from '@/components/page-frame';
import { DEFAULT_LOCALE } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';
import { pageHead } from '@/i18n/page-title';
import { LocaleProvider } from '@/i18n/use-t';
import type { FrameInfo } from '@/server/frame';

import appCss from '@/styles.css?url';

/**
 * What the frame of every page needs from the server: the language of the request (the `locale`
 * cookie, then `Accept-Language`, then German), whether it has a valid session, for the header's
 * Sign out button, and for a signed-in user the navigation and the notice about the member data
 * (`loadFrameInfo`). A failed check counts as signed out and is logged by code: the pages check
 * the session themselves, so the frame should not turn every page into an error page. The server
 * modules are imported inside the handler, so they stay out of the client bundle.
 */
const loadFrame = createServerFn({ method: 'GET' }).handler(
	async (): Promise<{ frame: FrameInfo | null; locale: Locale; signedIn: boolean }> => {
		const [
			{ getRequest },
			{ getRequestLocale },
			{ getAppContext },
			{ getSessionUser },
			{ loadPrincipal },
			{ loadFrameInfo },
			{ errorLabelWithCause },
		] = await Promise.all([
			import('@tanstack/react-start/server'),
			import('@/server/i18n/request-locale'),
			import('@/platform/context'),
			import('@/server/auth/session'),
			import('@/server/permissions/principal'),
			import('@/server/frame'),
			import('@/server/error-label'),
		]);
		const { headers } = getRequest();
		const locale = getRequestLocale(headers);
		try {
			const { auth, db } = await getAppContext();
			const user = await getSessionUser(auth, db, headers);
			if (user === null) return { frame: null, locale, signedIn: false };
			const principal = await loadPrincipal(db, user.id);
			const frame = principal === null ? null : await loadFrameInfo(db, principal, new Date());
			return { frame, locale, signedIn: true };
		} catch (error) {
			// oxlint-disable-next-line no-console -- code or name only, the message may carry details
			console.error('frame check failed', errorLabelWithCause(error));
			return { frame: null, locale, signedIn: false };
		}
	},
);

export const Route = createRootRoute({
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
	// Loader data is part of the SSR payload, so hydration renders what the server resolved.
	loader: async () => loadFrame(),
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above; ReactNode cannot be made deeply readonly
	shellComponent: function RootShell({ children }: Readonly<{ children: ReactNode }>): ReactNode {
		// Without loader data (the root loader failed) the error page still renders, in German.
		const data = useMatch({ from: '__root__', select: (match) => match.loaderData });
		const locale = data?.locale ?? DEFAULT_LOCALE;
		const router = useRouter();
		// React Aria's links (such as the tabs of the contact list) navigate through the router, so
		// they keep the document and its frame like the router's own links.
		const navigate = useCallback(
			(href: string) => {
				// oxlint-disable-next-line no-void -- the router shows its own error page, the promise never matters
				void router.navigate({ href });
			},
			[router],
		);
		return (
			<html lang={locale}>
				<head>
					<HeadContent />
				</head>
				<body>
					<LocaleProvider locale={locale}>
						<RouterProvider navigate={navigate}>
							<PageFrame frame={data?.frame ?? null} signedIn={data?.signedIn ?? false}>
								{children}
							</PageFrame>
						</RouterProvider>
					</LocaleProvider>
					<Scripts />
				</body>
			</html>
		);
	},
	// Resolved once per document: client navigation keeps the frame's data instead of asking the
	// server on every navigation (on Cloudflare, each call opens a database pool). Whatever changes
	// it loads a new document: the language switcher and Sign out reload the page, sign-in links
	// and Microsoft end on a new page, and the redirects of the setup's sign-in and of a missing
	// session (`requireRequestPrincipal`) reload the document (`reloadDocument`). A mutation's
	// `router.invalidate()` asks again. Protected pages still check the session on the server.
	staleTime: Number.POSITIVE_INFINITY,
});
