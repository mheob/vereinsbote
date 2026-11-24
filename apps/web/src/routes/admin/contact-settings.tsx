import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ContactAreasForm } from '@/components/admin/contact-settings/contact-areas-form';
import {
	CustomFieldsTable,
	FieldAreasTable,
} from '@/components/admin/contact-settings/field-areas-table';
import { StaleWeeksForm } from '@/components/admin/contact-settings/stale-weeks-form';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { loadContactSettingsPage } from '@/functions/contact-settings';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

export const Route = createFileRoute('/admin/contact-settings')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function ContactSettingsPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/admin/contact-settings' });
		const [announcement, announce] = useAnnouncer();
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('contactSettings.title')}</h1>
					<Announcements announcement={announcement} />
				</div>
				<ContactAreasForm announce={announce} areas={data.areas} settings={data.settings} />
				<FieldAreasTable announce={announce} areas={data.areas} fields={data.fields} />
				<CustomFieldsTable announce={announce} customFields={data.customFields} />
				<StaleWeeksForm announce={announce} weeks={data.settings.staleImportWeeks} />
			</div>
		);
	},
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'contactSettings.title'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context }) => (context.isAdmin ? loadContactSettingsPage() : null),
});
