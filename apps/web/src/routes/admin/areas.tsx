import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AreasTable } from '@/components/admin/areas-table';
import { CreateAreaForm } from '@/components/admin/create-area-form';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { loadAreasPage } from '@/functions/areas';
import { useT } from '@/i18n/use-t';

export const Route = createFileRoute('/admin/areas')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function AreasPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/admin/areas' });
		const [announcement, announce] = useAnnouncer();
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('areas.title')}</h1>
					<Announcements announcement={announcement} />
				</div>
				<AreasTable announce={announce} areas={data.areas} />
				<CreateAreaForm announce={announce} />
			</div>
		);
	},
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context }) => (context.isAdmin ? loadAreasPage() : null),
});
