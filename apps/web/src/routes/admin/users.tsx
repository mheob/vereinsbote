import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { InviteForm } from '@/components/admin/invite-form';
import { UsersTable } from '@/components/admin/users-table';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { loadUsersPage } from '@/functions/users';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

export const Route = createFileRoute('/admin/users')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function UsersPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/admin/users' });
		const [announcement, announce] = useAnnouncer();
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('users.title')}</h1>
					<Announcements announcement={announcement} />
				</div>
				<UsersTable announce={announce} areas={data.areas} users={data.users} />
				<InviteForm announce={announce} inviteLocale={data.inviteLocale} />
			</div>
		);
	},
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'users.title'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context }) => (context.isAdmin ? loadUsersPage() : null),
});
