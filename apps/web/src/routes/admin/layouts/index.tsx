import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router';
import { startTransition, useCallback } from 'react';
import type { ReactNode } from 'react';

import { CreateLayoutForm } from '@/components/admin/layouts/create-layout-form';
import { LayoutsTable } from '@/components/admin/layouts/layouts-table';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { loadLayoutList } from '@/functions/layouts';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * The global layouts for admins: the list with how many templates use each (a layout in use
 * cannot be deleted) and „Layout importieren“.
 */
export const Route = createFileRoute('/admin/layouts/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function LayoutsPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const data = useLoaderData({ from: '/admin/layouts/' });
		const [announcement, announce] = useAnnouncer();
		const reload = useCallback(() => {
			startTransition(async () => router.invalidate());
		}, [router]);
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<div className="flex flex-col gap-8">
				<div className="flex max-w-3xl flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('layouts.title')}</h1>
					<p>{t('layouts.intro')}</p>
					<Announcements announcement={announcement} />
				</div>
				<LayoutsTable announce={announce} layouts={data.layouts} onChanged={reload} />
				<CreateLayoutForm announce={announce} page={data} />
			</div>
		);
	},
	// A fresh list on every visit.
	gcTime: 0,
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'layouts.title'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context }) => (context.isAdmin ? loadLayoutList() : null),
});
