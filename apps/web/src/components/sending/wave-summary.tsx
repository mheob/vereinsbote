import type { ReactNode } from 'react';

import { formatBytes } from '@/components/images/image-size';
import { useLocale, useT } from '@/i18n/use-t';

import { estimateMessage, problemMessage, summaryRows } from './send-messages';
import type { SummaryState } from './summary-state';

/**
 * The numbers of a wave (Design 10.1, 10.5): its mails, the addresses several contacts share, the
 * excluded contacts by reason and how long it takes; in the dialog also its files. A problem that
 * refuses the wave and attachments too large for Graph are said below. On the recipient step the
 * numbers are a live region, so a screen reader reads them when they change.
 *
 * @param props The props.
 * @param props.state The summary.
 * @param props.live Whether the numbers are read when they change.
 * @param props.withAttachments Whether the files are a row of their own (the dialog).
 * @param props.attachments The number of files, for that row.
 * @returns The numbers.
 */
export function WaveSummaryView({
	attachments = 0,
	live,
	state,
	withAttachments = false,
}: Readonly<{
	state: SummaryState;
	live: boolean;
	withAttachments?: boolean;
	attachments?: number;
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const liveProps = live ? ({ 'aria-atomic': true, role: 'status' } as const) : {};
	if (state.status !== 'ready') {
		return (
			<div className="flex flex-col gap-2" {...liveProps}>
				<p>{t(state.status === 'counting' ? 'send.summary.counting' : 'auth.requestFailed')}</p>
			</div>
		);
	}
	const { summary } = state;
	const estimate = estimateMessage(summary.estimatedDays);
	const files =
		attachments === 0
			? t('send.attachments.none')
			: t('send.attachments.value', {
					count: attachments,
					size: formatBytes(summary.attachmentsBytes, locale),
				});
	return (
		<div className="flex flex-col gap-3" {...liveProps}>
			<dl className="grid max-w-2xl grid-cols-[1fr_max-content] gap-x-6 gap-y-1">
				{summaryRows(summary).map(({ label, value }) => (
					<div className="contents" key={label}>
						<dt>{t(label)}</dt>
						<dd className="text-right font-semibold tabular-nums">{value}</dd>
					</div>
				))}
				{withAttachments ? (
					<div className="contents">
						<dt>{t('send.attachmentsLabel')}</dt>
						<dd className="text-right font-semibold">{files}</dd>
					</div>
				) : null}
				<div className="contents">
					<dt>{t('send.estimate.label')}</dt>
					<dd className="text-right font-semibold">{t(estimate.key, estimate.params)}</dd>
				</div>
			</dl>
			<p className="max-w-2xl text-sm text-gray-700">{t('send.estimate.note')}</p>
			{summary.problem === null ? null : (
				<p className="max-w-2xl font-semibold text-red-700">{t(problemMessage(summary.problem))}</p>
			)}
			{summary.graphTooLarge ? (
				<p className="max-w-2xl font-semibold text-red-700">{t('send.graphTooLarge')}</p>
			) : null}
		</div>
	);
}
