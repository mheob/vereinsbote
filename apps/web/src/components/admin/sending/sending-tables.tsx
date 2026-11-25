import { Link } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import { linkClass } from '@/components/styles';
import type { OverviewConnection, OverviewSender } from '@/functions/sending';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';

/** From how many days before the expiry of a secret the overview warns. */
const SECRET_WARNING_DAYS = 30;

const tableClass =
	'w-full border-collapse outline-none data-focus-visible:outline-2 data-focus-visible:outline-blue-700';
const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
const cellClass =
	'px-3 py-2 align-top outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';
const rowClass =
	'border-b border-gray-300 outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';

/** One thing that is wrong with, or worth knowing about, a connection. */
interface State {
	readonly text: string;
	readonly isWarning: boolean;
}

/**
 * What the overview says about a connection: disturbed, secret about to expire or expired,
 * restriction missing or not checkable; „In Ordnung“ when there is nothing to say.
 *
 * @param connection The connection.
 * @param t The translation function.
 * @param locale The language, for the date.
 * @returns The states, at least one.
 */
function connectionStates(
	connection: OverviewConnection,
	t: ReturnType<typeof useT>,
	locale: ReturnType<typeof useLocale>,
): State[] {
	const states: State[] = [];
	if (connection.disturbedSince !== null) {
		const since = new Date(connection.disturbedSince);
		const date = formatClubDate(since, locale);
		states.push({ isWarning: true, text: t('sending.stateDisturbed', { date }) });
	}
	const days = connection.secretDaysLeft;
	if (days !== null && days <= SECRET_WARNING_DAYS) {
		let text = t('sending.secretExpiresIn', { count: days });
		if (days < 0) text = t('sending.secretExpired');
		else if (days === 0) text = t('sending.secretExpiresToday');
		else if (days === 1) text = t('sending.secretExpiresTomorrow');
		states.push({ isWarning: true, text });
	}
	if (connection.restriction === 'readable') {
		states.push({ isWarning: true, text: t('sending.restrictionReadable') });
	} else if (connection.restriction === 'unknown') {
		states.push({ isWarning: false, text: t('sending.restrictionUnknown') });
	}
	return states.length === 0 ? [{ isWarning: false, text: t('sending.stateOk') }] : states;
}

/**
 * A link to the page of a connection.
 *
 * @param props The props.
 * @param props.id The connection.
 * @param props.name Its name.
 * @returns The link.
 */
function ConnectionLink({ id, name }: Readonly<{ id: string; name: string }>): ReactNode {
	const params = useMemo(() => ({ connectionId: id }), [id]);
	return (
		<Link className={linkClass} params={params} to="/admin/sending/connections/$connectionId">
			{name}
		</Link>
	);
}

/**
 * A link to the page of a sender.
 *
 * @param props The props.
 * @param props.id The sender.
 * @param props.email Its address.
 * @returns The link.
 */
function SenderLink({ email, id }: Readonly<{ id: string; email: string }>): ReactNode {
	const params = useMemo(() => ({ senderId: id }), [id]);
	return (
		<Link className={linkClass} params={params} to="/admin/sending/senders/$senderId">
			{email}
		</Link>
	);
}

/**
 * The connections as a table: name (the link to its page), type, state and the number of senders.
 *
 * @param props The props.
 * @param props.connections The connections.
 * @returns The table.
 */
export function ConnectionsTable({
	connections,
}: Readonly<{ connections: readonly OverviewConnection[] }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('sending.connectionsEmpty')}</p>,
		[t],
	);
	return (
		<div className="overflow-x-auto">
			<Table aria-label={t('sending.connectionsCaption')} className={tableClass}>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass} isRowHeader>
						{t('sending.nameColumn')}
					</Column>
					<Column className={headerCellClass}>{t('sending.kindColumn')}</Column>
					<Column className={headerCellClass}>{t('sending.stateColumn')}</Column>
					<Column className={headerCellClass}>{t('sending.sendersColumn')}</Column>
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					items={connections}
					renderEmptyState={renderEmptyState}
				>
					{(item) => (
						<Row className={rowClass} id={item.id}>
							<Cell className={cellClass}>
								<ConnectionLink id={item.id} name={item.name} />
							</Cell>
							<Cell className={cellClass}>
								{t(item.kind === 'graph' ? 'sending.kindGraph' : 'sending.kindResend')}
							</Cell>
							<Cell className={cellClass}>
								<ul>
									{connectionStates(item, t, locale).map((state) => (
										<li
											className={state.isWarning ? 'font-semibold text-red-700' : undefined}
											key={state.text}
										>
											{state.text}
										</li>
									))}
								</ul>
							</Cell>
							<Cell className={cellClass}>{item.senders}</Cell>
						</Row>
					)}
				</TableBody>
			</Table>
		</div>
	);
}

/**
 * The senders as a table: address (the link to its page), connection, released areas and the
 * mark of the system sender.
 *
 * @param props The props.
 * @param props.senders The senders.
 * @returns The table.
 */
export function SendersTable({
	senders,
}: Readonly<{ senders: readonly OverviewSender[] }>): ReactNode {
	const t = useT();
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('sending.sendersEmpty')}</p>,
		[t],
	);
	return (
		<div className="overflow-x-auto">
			<Table aria-label={t('sending.sendersCaption')} className={tableClass}>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass} isRowHeader>
						{t('sending.addressColumn')}
					</Column>
					<Column className={headerCellClass}>{t('sending.connectionColumn')}</Column>
					<Column className={headerCellClass}>{t('sending.areasColumn')}</Column>
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					items={senders}
					renderEmptyState={renderEmptyState}
				>
					{(item) => (
						<Row className={rowClass} id={item.id}>
							<Cell className={cellClass}>
								<SenderLink email={item.email} id={item.id} />
								{item.isSystem ? (
									<span className="ml-2 rounded-sm border border-gray-600 px-1.5 text-sm">
										{t('sending.systemSender')}
									</span>
								) : null}
							</Cell>
							<Cell className={cellClass}>{item.connectionName}</Cell>
							<Cell className={cellClass}>
								{item.areaNames.length === 0 ? t('sending.noAreas') : item.areaNames.join(', ')}
							</Cell>
						</Row>
					)}
				</TableBody>
			</Table>
		</div>
	);
}
