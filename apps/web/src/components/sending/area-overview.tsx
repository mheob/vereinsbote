import { useServerFn } from '@tanstack/react-start';
import { useCallback, useId, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';

import type { Announce } from '@/components/announcements';
import { ContactPager } from '@/components/contacts/contact-table';
import type { PageDirection } from '@/components/contacts/contact-table';
import { FAILED, settle } from '@/components/settle';
import { AreaSelect } from '@/components/templates/area-select';
import { loadAreaOverview } from '@/functions/waves';
import { useT } from '@/i18n/use-t';
import { pageCount } from '@/server/contacts/list-query';
import type { AreaOverview, OverviewArea } from '@/server/waves/overview';

import { BounceList } from './bounce-list';
import { WaveTable } from './wave-table';

/** The step of a page change. */
const PAGE_STEP: Readonly<Record<PageDirection, number>> = { next: 1, previous: -1 };

/** The overview as shown, and how its page of waves was reached. */
type ViewState = Readonly<{ overview: AreaOverview; pagedBy: PageDirection | null }>;

/**
 * The overview of one area (Design 16): the choice of the area (as on the template pages, not part
 * of the URL), a page of its waves, newest first, and its bounce marks. The area and the page are
 * the component's state; a change loads them through `loadAreaOverview` and is announced, the page
 * of the waves like the contact list's. A cleared mark loads the list anew; the focus then moves to
 * the heading of the marks, as the row with the focused button is gone.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.areas The areas the user reads.
 * @param props.initial The overview of the first area.
 * @returns The overview.
 */
export function AreaOverviewView({
	announce,
	areas,
	initial,
}: Readonly<{
	announce: Announce;
	areas: readonly OverviewArea[];
	initial: AreaOverview;
}>): ReactNode {
	const t = useT();
	const load = useServerFn(loadAreaOverview);
	const [isPending, startPending] = useTransition();
	const [state, setState] = useState<ViewState>({ overview: initial, pagedBy: null });
	const wavesHeadingId = useId();
	const bouncesHeadingId = useId();
	const bouncesHeadingRef = useRef<HTMLHeadingElement>(null);
	const { overview } = state;
	const area = useMemo(
		() => areas.find(({ id }) => id === overview.areaId),
		[areas, overview.areaId],
	);
	const show = useCallback(
		(
			wanted: Readonly<{ areaId: string; page: number; pagedBy: PageDirection | null }>,
			after?: (shown: AreaOverview) => void,
		) => {
			startPending(async () => {
				const { areaId, page, pagedBy } = wanted;
				const result = await settle(load({ data: { areaId, page } }));
				if (result === undefined) return;
				if (result === FAILED) {
					announce(t('auth.requestFailed'), 'alert');
					return;
				}
				setState({ overview: result, pagedBy });
				after?.(result);
			});
		},
		[announce, load, t],
	);
	const onArea = useCallback(
		(areaId: string) => {
			const name = areas.find(({ id }) => id === areaId)?.name ?? '';
			show({ areaId, page: 1, pagedBy: null }, () => {
				announce(t('overview.areaShown', { area: name }), 'status');
			});
		},
		[announce, areas, show, t],
	);
	const onPage = useCallback(
		(direction: PageDirection) => {
			const page = overview.page + PAGE_STEP[direction];
			show({ areaId: overview.areaId, page, pagedBy: direction }, (shown) => {
				const pages = pageCount(shown.waves.total);
				announce(t('contacts.pageShown', { page: shown.page, pages }), 'status');
			});
		},
		[announce, overview.areaId, overview.page, show, t],
	);
	const onCleared = useCallback(() => {
		bouncesHeadingRef.current?.focus();
		// The button announces the result itself.
		show({ areaId: overview.areaId, page: overview.page, pagedBy: null });
	}, [overview.areaId, overview.page, show]);
	const areaName = area?.name ?? '';
	return (
		<>
			{areas.length > 1 ? (
				<AreaSelect
					areas={areas}
					label={t('overview.areaLabel')}
					onChange={onArea}
					value={overview.areaId}
				/>
			) : (
				<p>{t('overview.areaOnly', { area: areaName })}</p>
			)}
			<section aria-labelledby={wavesHeadingId} className="flex flex-col gap-3">
				<h2 className="text-xl font-bold" id={wavesHeadingId}>
					{t('overview.wavesHeading')}
				</h2>
				<WaveTable areaName={areaName} waves={overview.waves.items} />
				<ContactPager
					isPending={isPending}
					onPage={onPage}
					page={overview.page}
					pagedBy={state.pagedBy}
					pages={pageCount(overview.waves.total)}
				/>
			</section>
			<section aria-labelledby={bouncesHeadingId} className="flex flex-col gap-3">
				<h2
					className="text-xl font-bold outline-none"
					id={bouncesHeadingId}
					ref={bouncesHeadingRef}
					tabIndex={-1}
				>
					{t('overview.bouncesHeading')}
				</h2>
				<p>{t('overview.bouncesIntro')}</p>
				<BounceList
					announce={announce}
					areaName={areaName}
					bounces={overview.bounces}
					canClear={area?.canEdit ?? false}
					onCleared={onCleared}
				/>
			</section>
		</>
	);
}
