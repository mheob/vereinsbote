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
import { linkClass } from '@/components/styles';
import { AreaSelect } from '@/components/templates/area-select';
import { TemplateTable } from '@/components/templates/template-table';
import { loadTemplateList } from '@/functions/templates';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/** The filter value for every area. */
const ALL_AREAS = 'all';

/**
 * The templates of the areas the user may read, with a filter by area (not part of the URL).
 * Whoever may edit somewhere also sees „Neue Vorlage“ and the actions of the templates they may
 * change. A template deleted on its own page is announced here once, from the history state.
 */
export const Route = createFileRoute('/templates/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function TemplatesPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const data = useLoaderData({ from: '/templates/' });
		const notice = useLocation({ select: (location) => location.state.templateNotice });
		const headingRef = useRef<HTMLHeadingElement>(null);
		const [announcement, announce] = useAnnouncer();
		const [areaFilter, setAreaFilter] = useState(ALL_AREAS);
		useEffect(() => {
			if (notice?.kind !== 'deleted') return;
			headingRef.current?.focus();
			announce(t('templates.deleted', { name: notice.name }), 'status');
			clearHistoryNotice(globalThis.history, 'templateNotice');
		}, [announce, notice, t]);
		const onRemoved = useCallback(
			(item: Readonly<{ name: string }>, result: 'deleted' | 'gone') => {
				// The row with the focused button is gone: the focus starts at the heading again.
				headingRef.current?.focus();
				if (result === 'deleted') announce(t('templates.deleted', { name: item.name }), 'status');
				startTransition(async () => router.invalidate());
			},
			[announce, router, t],
		);
		const filterChoices = useMemo(
			() => [{ id: ALL_AREAS, name: t('templates.areaAll') }, ...data.areas],
			[data.areas, t],
		);
		// An area that is gone after a reload no longer filters.
		const filter = filterChoices.some(({ id }) => id === areaFilter) ? areaFilter : ALL_AREAS;
		const shown = useMemo(
			() =>
				filter === ALL_AREAS
					? data.templates
					: data.templates.filter(({ areaId }) => areaId === filter),
			[data.templates, filter],
		);
		return (
			<>
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold outline-none" ref={headingRef} tabIndex={-1}>
						{t('templates.title')}
					</h1>
					<Announcements announcement={announcement} />
				</div>
				{data.areas.some(({ canEdit }) => canEdit) ? (
					<Link className={`self-start ${linkClass}`} to="/templates/new">
						{t('templates.new')}
					</Link>
				) : null}
				{data.areas.length > 1 ? (
					<AreaSelect
						areas={filterChoices}
						label={t('templates.areaLabel')}
						onChange={setAreaFilter}
						value={filter}
					/>
				) : null}
				<TemplateTable
					announce={announce}
					areas={data.areas}
					onRemoved={onRemoved}
					templates={shown}
				/>
			</>
		);
	},
	// A fresh list on every visit.
	gcTime: 0,
	head: (context) => pageHead(context, 'templates.title'),
	loader: async () => loadTemplateList(),
});
