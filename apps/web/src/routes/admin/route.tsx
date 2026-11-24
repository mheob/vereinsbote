import { createFileRoute, Outlet, useRouteContext } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';

import { AdminNav } from '@/components/admin-nav';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/** HTTP status of the admin pages for a signed-in user without the admin role. */
const HTTP_FORBIDDEN = 403;

/**
 * Who may see the admin pages. Without a session the visitor goes to the sign-in page; a user
 * without the admin role gets the page "no access" with status 403. Server modules are imported
 * inside the handler, so they stay out of the client bundle. The server functions of the admin
 * pages check the role again, since they are reachable without this page.
 */
const loadAdminAccess = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ setResponseStatus }, { requireRequestPrincipal }] = await Promise.all([
		import('@tanstack/react-start/server'),
		import('@/platform/request-principal'),
	]);
	const { principal } = await requireRequestPrincipal();
	// The status of the page when the server renders it; a client-side navigation ignores it.
	if (!principal.isAdmin) setResponseStatus(HTTP_FORBIDDEN);
	return { isAdmin: principal.isAdmin };
});

export const Route = createFileRoute('/admin')({
	beforeLoad: async () => loadAdminAccess(),
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function AdminLayout(): ReactNode {
		const t = useT();
		const { isAdmin } = useRouteContext({ from: '/admin' });
		if (!isAdmin) {
			return (
				<div className="mx-auto flex max-w-md flex-col gap-4 p-6">
					<h1 className="text-2xl font-bold">{t('admin.forbidden')}</h1>
					<p>{t('admin.forbiddenText')}</p>
				</div>
			);
		}
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
				<AdminNav />
				<Outlet />
			</div>
		);
	},
	// An admin page names itself; this title is the one of "no access".
	head: (context) => pageHead(context, 'admin.forbidden'),
});
