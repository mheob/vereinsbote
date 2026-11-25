import { createFileRoute, Link, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ReplaceLayoutForm } from '@/components/admin/layouts/replace-layout-form';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import { loadLayoutPage } from '@/functions/layouts';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * One global layout for admins: its name, how many templates use it and „HTML ersetzen“. A
 * layout that does not exist is „not found“.
 */
export const Route = createFileRoute('/admin/layouts/$layoutId')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function LayoutPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/admin/layouts/$layoutId' });
		const [announcement, announce] = useAnnouncer();
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		const { usedBy } = data.layout;
		return (
			<div className="flex flex-col gap-6">
				<Link className={`self-start ${linkClass}`} to="/admin/layouts">
					{t('layouts.back')}
				</Link>
				<div className="flex max-w-3xl flex-col gap-2">
					<h1 className="text-2xl font-bold">{data.layout.name}</h1>
					<p>
						{usedBy === 0
							? t('layouts.notUsed')
							: t('layouts.usageNote', {
									usage:
										usedBy === 1 ? t('layouts.usedByOne') : t('layouts.usedBy', { count: usedBy }),
								})}
					</p>
					<p>{t('layouts.replaceHelp')}</p>
					<Announcements announcement={announcement} />
				</div>
				<ReplaceLayoutForm announce={announce} page={data} />
			</div>
		);
	},
	// A fresh layout on every visit.
	gcTime: 0,
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'layouts.pageTitle'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context, params }) =>
		context.isAdmin ? loadLayoutPage({ data: { id: params.layoutId } }) : null,
});
