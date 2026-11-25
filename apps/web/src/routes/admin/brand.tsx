import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { BrandForm } from '@/components/admin/brand/brand-form';
import { loadBrandPage } from '@/functions/brand';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

export const Route = createFileRoute('/admin/brand')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function BrandPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/admin/brand' });
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<div className="flex flex-col gap-6">
				<div className="flex max-w-3xl flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('brand.title')}</h1>
					<p>{t('brand.intro')}</p>
				</div>
				<BrandForm page={data} />
			</div>
		);
	},
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'brand.title'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context }) => (context.isAdmin ? loadBrandPage() : null),
});
