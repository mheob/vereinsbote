import { Link } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { EntryRow } from '@/server/waves/overview';

import { entryCodeText, entryStatusText } from './overview-texts';
import { ResendEntryDialog } from './resend-entry-dialog';

const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
const cellClass =
	'px-3 py-2 align-top outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';
const rowClass =
	'border-b border-gray-300 outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * The recipient of an entry: the contact's name as the link to its page (or „Kontakt gelöscht“),
 * the address the mail went to and, for a circular to a shared address, how many more contacts
 * share it.
 *
 * @param props The props.
 * @param props.entry The entry.
 * @returns The recipient.
 */
function Recipient({ entry }: Readonly<{ entry: EntryRow }>): ReactNode {
	const t = useT();
	const { contactId, merged, recipientEmail, recipientName } = entry;
	const params = useMemo(() => ({ contactId: contactId ?? '' }), [contactId]);
	const more = merged - 1;
	return (
		<>
			{contactId === null || recipientName === null ? (
				<span className="block">{t('overview.contactDeleted')}</span>
			) : (
				<Link className={linkClass} params={params} to="/contacts/$contactId">
					{recipientName}
				</Link>
			)}
			<span className="block text-sm text-gray-700">{recipientEmail}</span>
			{more > 0 ? (
				<span className="block text-sm text-gray-700">
					{more === 1 ? t('overview.mergedOne') : t('overview.merged', { count: more })}
				</span>
			) : null}
		</>
	);
}

/**
 * The entries of a wave as a table: the recipient (base fields only), the status and the reason of
 * a skip, a failure or a bounce, never the mail itself. Whoever may send in the wave's area gets
 * „Erneut senden“ at an uncertain entry while the wave is not stopped. Without entries the table
 * says so.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.canResend Whether the user may send uncertain entries again: `send`, wave not
 *   stopped.
 * @param props.entries The entries of the page.
 * @param props.onChanged Called after an entry changed: the page loads anew.
 * @returns The table.
 */
export function EntryTable({
	announce,
	canResend,
	entries,
	onChanged,
}: Readonly<{
	announce: Announce;
	canResend: boolean;
	entries: readonly EntryRow[];
	onChanged: () => void;
}>): ReactNode {
	const t = useT();
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('overview.entriesEmpty')}</p>,
		[t],
	);
	// What the rows read besides their entry: a change renders them anew.
	const rowDependencies = useMemo(
		() => [announce, canResend, onChanged],
		[announce, canResend, onChanged],
	);
	return (
		<div className="overflow-x-auto">
			<Table
				aria-label={t('overview.entriesCaption')}
				className="w-full border-collapse outline-none data-focus-visible:outline-2 data-focus-visible:outline-blue-700"
			>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass} isRowHeader>
						{t('overview.recipientColumn')}
					</Column>
					<Column className={headerCellClass}>{t('overview.statusColumn')}</Column>
					<Column className={headerCellClass}>{t('overview.codeColumn')}</Column>
					{canResend ? (
						<Column className={headerCellClass}>{t('overview.actionsColumn')}</Column>
					) : null}
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					dependencies={rowDependencies}
					items={entries}
					renderEmptyState={renderEmptyState}
				>
					{(entry) => (
						<Row className={rowClass} id={entry.id}>
							<Cell className={cellClass}>
								<Recipient entry={entry} />
							</Cell>
							<Cell className={cellClass}>{entryStatusText(entry.status, t)}</Cell>
							<Cell className={cellClass}>
								{entry.code === null ? null : entryCodeText(entry.code, t)}
							</Cell>
							{canResend ? (
								<Cell className={cellClass}>
									{entry.status === 'uncertain' ? (
										<ResendEntryDialog
											announce={announce}
											email={entry.recipientEmail}
											entryId={entry.id}
											onChanged={onChanged}
										/>
									) : null}
								</Cell>
							) : null}
						</Row>
					)}
				</TableBody>
			</Table>
		</div>
	);
}
