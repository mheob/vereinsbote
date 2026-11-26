import {
	createFileRoute,
	Link,
	useLoaderData,
	useLocation,
	useRouter,
} from '@tanstack/react-router';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { clearHistoryNotice } from '@/components/contacts/history-notice';
import { OccasionTable } from '@/components/occasions/occasion-table';
import { linkClass } from '@/components/styles';
import { AreaSelect } from '@/components/templates/area-select';
import { loadOccasionList } from '@/functions/occasions';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/** The filter value for every area. */
const ALL_AREAS = 'all';

/**
 * The occasions of the areas the user may read, with a filter by area (not part of the URL).
 * Whoever may edit somewhere also sees „Neuer Anlass“ and the actions of the occasions they may
 * change. An occasion deleted or archived on its own page is announced here once, from the
 * history state.
 */
export const Route = createFileRoute('/occasions/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function OccasionsPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const data = useLoaderData({ from: '/occasions/' });
		const notice = useLocation({ select: (location) => location.state.occasionNotice });
		const headingRef = useRef<HTMLHeadingElement>(null);
		const [announcement, announce] = useAnnouncer();
		const [areaFilter, setAreaFilter] = useState(ALL_AREAS);
		useEffect(() => {
			if (notice === undefined) return;
			headingRef.current?.focus();
			const key = notice.kind === 'deleted' ? 'occasions.deleted' : 'occasions.archivedNotice';
			announce(t(key, { name: notice.name }), 'status');
			clearHistoryNotice(globalThis.history, 'occasionNotice');
		}, [announce, notice, t]);
		const onRemoved = useCallback(
			(item: Readonly<{ name: string }>, result: 'archived' | 'deleted' | 'gone') => {
				// The row with the focused button is gone or changed: the focus starts at the heading.
				headingRef.current?.focus();
				if (result === 'deleted') announce(t('occasions.deleted', { name: item.name }), 'status');
				if (result === 'archived') {
					announce(t('occasions.archivedNotice', { name: item.name }), 'status');
				}
				startTransition(async () => router.invalidate());
			},
			[announce, router, t],
		);
		const filterChoices = useMemo(
			() => [{ id: ALL_AREAS, name: t('occasions.areaAll') }, ...data.areas],
			[data.areas, t],
		);
		// An area that is gone after a reload no longer filters.
		const filter = filterChoices.some(({ id }) => id === areaFilter) ? areaFilter : ALL_AREAS;
		const shown = useMemo(
			() =>
				filter === ALL_AREAS
					? data.occasions
					: data.occasions.filter(({ areaId }) => areaId === filter),
			[data.occasions, filter],
		);
		return (
			<>
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold outline-none" ref={headingRef} tabIndex={-1}>
						{t('occasions.title')}
					</h1>
					<Announcements announcement={announcement} />
				</div>
				{data.areas.some(({ canEdit }) => canEdit) ? (
					<Link className={`self-start ${linkClass}`} to="/occasions/new">
						{t('occasions.new')}
					</Link>
				) : null}
				{data.areas.length > 1 ? (
					<AreaSelect
						areas={filterChoices}
						label={t('occasions.areaLabel')}
						onChange={setAreaFilter}
						value={filter}
					/>
				) : null}
				<OccasionTable
					announce={announce}
					areas={data.areas}
					occasions={shown}
					onRemoved={onRemoved}
					senders={data.senders}
					templates={data.templates}
				/>
			</>
		);
	},
	// A fresh list on every visit.
	gcTime: 0,
	head: (context) => pageHead(context, 'occasions.title'),
	loader: async () => loadOccasionList(),
});
