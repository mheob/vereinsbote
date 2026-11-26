import { createFileRoute, Link, useLoaderData, useRouter } from '@tanstack/react-router';
import { startTransition, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { DeleteOccasionDialog } from '@/components/occasions/delete-occasion-dialog';
import type { RemovedOccasion } from '@/components/occasions/delete-occasion-dialog';
import { OccasionDetails } from '@/components/occasions/occasion-details';
import { OccasionForm } from '@/components/occasions/occasion-form';
import { linkClass } from '@/components/styles';
import { loadOccasionPage } from '@/functions/occasions';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * One occasion. Whoever edits its area changes it in a form and may delete it (archive it when it
 * has waves); everybody else, and everybody for an archived occasion, reads it. An occasion that
 * does not exist, or that the user may not read, is "not found". After a removal the list
 * announces it once, from the history state.
 */
export const Route = createFileRoute('/occasions/$occasionId')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function OccasionPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const page = useLoaderData({ from: '/occasions/$occasionId' });
		const headingRef = useRef<HTMLHeadingElement>(null);
		const [announcement, announce] = useAnnouncer();
		const { occasion } = page;
		const { name } = occasion;
		const onRemoved = useCallback(
			(result: RemovedOccasion) => {
				startTransition(async () => {
					await router.navigate({
						state: result === 'gone' ? {} : { occasionNotice: { kind: result, name } },
						to: '/occasions',
					});
				});
			},
			[name, router],
		);
		const ownArea = useMemo(
			() => page.areas.filter(({ id }) => id === occasion.areaId),
			[occasion.areaId, page.areas],
		);
		const reload = useCallback(() => {
			startTransition(async () => router.invalidate());
		}, [router]);
		return (
			<>
				<Link className={`self-start ${linkClass}`} to="/occasions">
					{t('occasions.back')}
				</Link>
				<h1 className="text-2xl font-bold outline-none" ref={headingRef} tabIndex={-1}>
					{occasion.name}
				</h1>
				<Announcements announcement={announcement} />
				{occasion.archivedAt === null ? null : <p>{t('occasions.archivedNote')}</p>}
				{page.canEdit ? (
					<>
						<OccasionForm
							key={`form-${occasion.version}`}
							announce={announce}
							areas={ownArea}
							occasion={occasion}
							onGone={reload}
							onSaved={reload}
							senders={page.senders}
							templates={page.templates}
						/>
						<div>
							<DeleteOccasionDialog
								announce={announce}
								label={t(occasion.waves > 0 ? 'occasions.archiveAria' : 'occasions.deleteAria', {
									name,
								})}
								occasion={occasion}
								onRemoved={onRemoved}
							/>
						</div>
					</>
				) : (
					<OccasionDetails page={page} />
				)}
			</>
		);
	},
	// A fresh load on every visit: a cached copy would show the occasion as it was before a save.
	gcTime: 0,
	// The context is annotated: the loader reads `params`, and an unannotated `head` would keep
	// TypeScript from inferring the loader's data (like the template and admin pages).
	head: (context: Parameters<typeof pageHead>[0]) => pageHead(context, 'occasions.pageTitle'),
	loader: async ({ params }) => loadOccasionPage({ data: { id: params.occasionId } }),
});
