import { createFileRoute, Outlet, useRouteContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { loadContactsAccess } from '@/functions/contacts';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * The layout of the contact pages. Without a session the visitor goes to the sign-in page; a
 * user without `read` in any area gets the page "no access" with status 403. The access is the
 * route context of the pages below, for their titles and loaders. Their server functions check
 * the access again, since they are reachable without these pages.
 */
export const Route = createFileRoute('/contacts')({
	beforeLoad: async () => ({ access: await loadContactsAccess() }),
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function ContactsLayout(): ReactNode {
		const t = useT();
		const { access } = useRouteContext({ from: '/contacts' });
		if (!access.canList) {
			return (
				<div className="mx-auto flex max-w-md flex-col gap-4 p-6">
					<h1 className="text-2xl font-bold">{t('admin.forbidden')}</h1>
					<p>{t('contacts.forbiddenText')}</p>
				</div>
			);
		}
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
				<Outlet />
			</div>
		);
	},
	// A contact page names itself; this title is the one of "no access".
	head: (context) => pageHead(context, 'admin.forbidden'),
});
