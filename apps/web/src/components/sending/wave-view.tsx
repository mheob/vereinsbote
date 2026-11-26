import { Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useId, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { ContactPager } from '@/components/contacts/contact-table';
import type { PageDirection } from '@/components/contacts/contact-table';
import { FAILED, settle } from '@/components/settle';
import { linkClass } from '@/components/styles';
import { loadWaveEntries } from '@/functions/waves';
import { useLocale, useT } from '@/i18n/use-t';
import { pageCount } from '@/server/contacts/list-query';
import type { WavePage } from '@/server/waves/overview';

import { EntryTable } from './entry-table';
import { countsText, waveStateText } from './overview-texts';
import { formatClubDateTime } from './schedule';
import { StopWaveDialog } from './stop-wave-dialog';

/** The step of a page change. */
const PAGE_STEP: Readonly<Record<PageDirection, number>> = { next: 1, previous: -1 };

/** The page as shown, and how its page of entries was reached. */
type ViewState = Readonly<{ shown: WavePage; pagedBy: PageDirection | null }>;

/**
 * The page of a wave (Design 16): its occasion (the link to its page), area, start, state and the
 * counts of its entries, a page of its entries (recipients by base fields, status and reason, never
 * the mail) and, for who may send in its area, „Welle stoppen“ while it is planned or running and
 * „Erneut senden“ at an uncertain entry while it is not stopped. A page change, a stop and a resend load the wave and the page
 * anew through `loadWaveEntries`; after a stop the focus moves to the heading, after a resend to
 * the heading of the entries, as the pressed button is gone.
 *
 * @param props The props.
 * @param props.initial The wave and the first page of its entries.
 * @returns The page's content.
 */
export function WaveView({ initial }: Readonly<{ initial: WavePage }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const load = useServerFn(loadWaveEntries);
	const [announcement, announce] = useAnnouncer();
	const [isPending, startPending] = useTransition();
	const [state, setState] = useState<ViewState>({ pagedBy: null, shown: initial });
	const [gone, setGone] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const entriesHeadingRef = useRef<HTMLHeadingElement>(null);
	const entriesHeadingId = useId();
	const { entries, page, wave } = state.shown;
	const occasionParams = useMemo(() => ({ occasionId: wave.occasionId }), [wave.occasionId]);
	const show = useCallback(
		(
			wanted: Readonly<{ page: number; pagedBy: PageDirection | null }>,
			after?: (shown: WavePage) => void,
		) => {
			startPending(async () => {
				const result = await settle(load({ data: { page: wanted.page, waveId: wave.id } }));
				if (result === undefined) return;
				if (result === FAILED) {
					announce(t('auth.requestFailed'), 'alert');
					return;
				}
				if (!result.ok) {
					setGone(true);
					announce(t('overview.waveGone'), 'alert');
					return;
				}
				setState({ pagedBy: wanted.pagedBy, shown: result.page });
				after?.(result.page);
			});
		},
		[announce, load, t, wave.id],
	);
	const onPage = useCallback(
		(direction: PageDirection) => {
			show({ page: page + PAGE_STEP[direction], pagedBy: direction }, (shown) => {
				const pages = pageCount(shown.entries.total);
				announce(t('contacts.pageShown', { page: shown.page, pages }), 'status');
			});
		},
		[announce, page, show, t],
	);
	// The focus moves once the page is loaded anew: the dialog first gives it back to its button,
	// which the new page no longer has.
	const onStopped = useCallback(() => {
		show({ page, pagedBy: null }, () => {
			headingRef.current?.focus();
		});
	}, [page, show]);
	const onChanged = useCallback(() => {
		show({ page, pagedBy: null }, () => {
			entriesHeadingRef.current?.focus();
		});
	}, [page, show]);
	const active = wave.state === 'planned' || wave.state === 'running';
	return (
		<>
			<Link className={`self-start ${linkClass}`} to="/sending">
				{t('overview.back')}
			</Link>
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold outline-none" ref={headingRef} tabIndex={-1}>
					{t('overview.waveHeading', { occasion: wave.occasionName })}
				</h1>
				<Announcements announcement={announcement} />
			</div>
			<dl className="grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
				<dt className="font-semibold">{t('overview.occasionTerm')}</dt>
				<dd>
					<Link className={linkClass} params={occasionParams} to="/occasions/$occasionId">
						{wave.occasionName}
					</Link>
				</dd>
				<dt className="font-semibold">{t('overview.areaTerm')}</dt>
				<dd>{wave.areaName}</dd>
				<dt className="font-semibold">{t('overview.startTerm')}</dt>
				<dd>{formatClubDateTime(wave.notBefore, locale)}</dd>
				<dt className="font-semibold">{t('overview.stateTerm')}</dt>
				<dd>{waveStateText(wave.state, t)}</dd>
				<dt className="font-semibold">{t('overview.countsTerm')}</dt>
				<dd>{countsText(wave.counts, t)}</dd>
			</dl>
			{wave.canSend && active && !gone ? (
				<StopWaveDialog announce={announce} onStopped={onStopped} wave={wave} />
			) : null}
			<section aria-labelledby={entriesHeadingId} className="flex flex-col gap-3">
				<h2
					className="text-xl font-bold outline-none"
					id={entriesHeadingId}
					ref={entriesHeadingRef}
					tabIndex={-1}
				>
					{t('overview.entriesHeading')}
				</h2>
				<p>{t('overview.entriesIntro')}</p>
				<EntryTable
					announce={announce}
					canResend={wave.canSend && wave.state !== 'stopped' && !gone}
					entries={entries.items}
					onChanged={onChanged}
				/>
				<ContactPager
					isPending={isPending}
					onPage={onPage}
					page={page}
					pagedBy={state.pagedBy}
					pages={pageCount(entries.total)}
				/>
			</section>
		</>
	);
}
