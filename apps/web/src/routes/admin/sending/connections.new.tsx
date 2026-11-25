import { createFileRoute, Link, useRouteContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ConnectionForm } from '@/components/admin/sending/connection-form';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/** „Anbindung anlegen“ for admins: the provider and its credentials. */
export const Route = createFileRoute('/admin/sending/connections/new')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function NewConnectionPage(): ReactNode {
		const t = useT();
		const { isAdmin } = useRouteContext({ from: '/admin' });
		const [announcement, announce] = useAnnouncer();
		// Without the admin role the layout shows "no access" instead of this page.
		if (!isAdmin) return null;
		return (
			<div className="flex flex-col gap-6">
				<Link className={`self-start ${linkClass}`} to="/admin/sending">
					{t('sending.back')}
				</Link>
				<div className="flex max-w-3xl flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('sending.connectionNewTitle')}</h1>
					<Announcements announcement={announcement} />
				</div>
				<ConnectionForm announce={announce} connection={null} />
			</div>
		);
	},
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'sending.connectionNewTitle'),
});
