import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router';
import { startTransition, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import { CreateTemplateForm } from '@/components/templates/create-template-form';
import { loadNewTemplate } from '@/functions/templates';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * Creates a template: the area (only those the user may edit), how to start, name and subject.
 * Without `edit` in any area the page says so; the server function refuses as well. The new
 * template's page opens afterwards.
 */
export const Route = createFileRoute('/templates/new')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function NewTemplatePage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const data = useLoaderData({ from: '/templates/new' });
		const editable = useMemo(() => data.areas.filter(({ canEdit }) => canEdit), [data.areas]);
		const onCreated = useCallback(
			(templateId: string) => {
				startTransition(async () => {
					await router.navigate({ params: { templateId }, to: '/templates/$templateId' });
				});
			},
			[router],
		);
		const onGone = useCallback(() => {
			startTransition(async () => router.invalidate());
		}, [router]);
		return (
			<>
				<h1 className="text-2xl font-bold">{t('templates.new')}</h1>
				{editable.length === 0 ? (
					<p className="max-w-md">{t('templates.createForbiddenText')}</p>
				) : (
					<CreateTemplateForm
						appOrigin={data.appOrigin}
						areas={editable}
						brand={data.brand}
						onCreated={onCreated}
						onGone={onGone}
					/>
				)}
			</>
		);
	},
	gcTime: 0,
	head: (context) => pageHead(context, 'templates.new'),
	loader: async () => loadNewTemplate(),
});
