import { createFileRoute, useLoaderData, useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import {
	ChoicePage,
	InvalidLinkPage,
	MessagePage,
} from '@/components/unsubscribe/unsubscribe-page';
import { loadUnsubscribePage } from '@/functions/unsubscribe';
import type { UnsubscribePageData } from '@/functions/unsubscribe';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/*
 * The page of an unsubscribe link (Design 12): public, in the language of the request, without the
 * frame of a signed-in user (the root loader reads no session here). Opening it changes nothing;
 * its form unsubscribes through a server function. The route answers the one-click POST of RFC 8058
 * itself (`handleOneClick`): mail providers post without cookies and without `Origin`, so it is no
 * server function and the CSRF check does not apply; the token is its protection.
 */

/**
 * Answers the one-click POST of a mail provider. The token is checked before the database opens.
 *
 * @param request The request.
 * @param token The token of the link.
 * @returns The empty answer of `handleOneClick`.
 */
async function oneClick(request: Request, token: string): Promise<Response> {
	const [{ handleOneClick }, { getAppContext, getAppEnv }] = await Promise.all([
		import('@/server/unsubscribe/one-click'),
		import('@/platform/context'),
	]);
	return handleOneClick(request, token, {
		async db() {
			const { db } = await getAppContext();
			return db;
		},
		env: getAppEnv,
		now: () => new Date(),
	});
}

export const Route = createFileRoute('/unsubscribe/$token')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function UnsubscribePage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/unsubscribe/$token' });
		const { token } = useParams({ from: '/unsubscribe/$token' });
		if (data.kind === 'test') {
			return <MessagePage text={t('unsubscribe.testText')} title={t('unsubscribe.testTitle')} />;
		}
		return <ChoicePage page={data} token={token} />;
	},
	// A fresh load on every visit: the names may have changed, and nothing of it stays cached.
	gcTime: 0,
	// The context is annotated, like the occasion page: an unannotated `head` would keep TypeScript
	// from inferring the loader's data.
	head: (
		context: Readonly<Parameters<typeof pageHead>[0] & { loaderData?: UnsubscribePageData }>,
	) =>
		pageHead(
			context,
			context.loaderData?.kind === 'test' ? 'unsubscribe.testTitle' : 'unsubscribe.title',
			{ notFound: 'unsubscribe.invalidTitle' },
		),
	loader: async ({ params }) => loadUnsubscribePage({ data: { token: params.token } }),
	notFoundComponent: InvalidLinkPage,
	server: {
		handlers: { POST: async ({ params, request }) => oneClick(request, params.token) },
	},
});
