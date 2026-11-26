import { createFileRoute, Link, useLoaderData, useRouter } from '@tanstack/react-router';
import { startTransition, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { OccasionForm } from '@/components/occasions/occasion-form';
import { linkClass } from '@/components/styles';
import { loadNewOccasion } from '@/functions/occasions';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * Creates an occasion: the area (only those the user may edit), name, kind, template, sender and
 * unsubscribe link, with the sentence that says what an occasion stands for. Without `edit` in
 * any area the page says so; the server function refuses as well. The occasion's page opens
 * afterwards.
 */
export const Route = createFileRoute('/occasions/new')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function NewOccasionPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const data = useLoaderData({ from: '/occasions/new' });
		const [announcement, announce] = useAnnouncer();
		const editable = useMemo(() => data.areas.filter(({ canEdit }) => canEdit), [data.areas]);
		const onCreated = useCallback(
			(occasionId: string) => {
				startTransition(async () => {
					await router.navigate({ params: { occasionId }, to: '/occasions/$occasionId' });
				});
			},
			[router],
		);
		const onGone = useCallback(() => {
			startTransition(async () => router.invalidate());
		}, [router]);
		return (
			<>
				<Link className={`self-start ${linkClass}`} to="/occasions">
					{t('occasions.back')}
				</Link>
				<h1 className="text-2xl font-bold">{t('occasions.new')}</h1>
				<Announcements announcement={announcement} />
				{editable.length === 0 ? (
					<p className="max-w-md">{t('occasions.createForbiddenText')}</p>
				) : (
					<>
						<p className="max-w-xl">{t('occasions.intro')}</p>
						<OccasionForm
							announce={announce}
							areas={editable}
							occasion={null}
							onCreated={onCreated}
							onGone={onGone}
							senders={data.senders}
							templates={data.templates}
						/>
					</>
				)}
			</>
		);
	},
	gcTime: 0,
	head: (context) => pageHead(context, 'occasions.new'),
	loader: async () => loadNewOccasion(),
});
