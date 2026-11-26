import { Link } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import type {
	OccasionArea,
	OccasionListPage,
	SenderChoice,
	TemplateChoice,
} from '@/functions/occasions';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';

import { DeleteOccasionDialog } from './delete-occasion-dialog';
import type { RemovedOccasion } from './delete-occasion-dialog';

type ListedOccasion = OccasionListPage['occasions'][number];

const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
const cellClass =
	'px-3 py-2 align-top outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';
const rowClass =
	'border-b border-gray-300 outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * The name of an occasion as the link to its page.
 *
 * @param props The props.
 * @param props.id The occasion.
 * @param props.name The name.
 * @returns The link.
 */
function OccasionLink({ id, name }: Readonly<{ id: string; name: string }>): ReactNode {
	const params = useMemo(() => ({ occasionId: id }), [id]);
	return (
		<Link className={linkClass} params={params} to="/occasions/$occasionId">
			{name}
		</Link>
	);
}

/**
 * The actions on an occasion of an area the user edits: „Bearbeiten“ and „Löschen“. An archived
 * occasion has none.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.item The occasion.
 * @param props.onRemoved Called after the occasion is gone or archived.
 * @returns The actions.
 */
function OccasionActions({
	announce,
	item,
	onRemoved,
}: Readonly<{
	announce: Announce;
	item: ListedOccasion;
	onRemoved: (item: ListedOccasion, result: RemovedOccasion) => void;
}>): ReactNode {
	const t = useT();
	const params = useMemo(() => ({ occasionId: item.id }), [item.id]);
	const removed = useCallback(
		(result: RemovedOccasion) => {
			onRemoved(item, result);
		},
		[item, onRemoved],
	);
	if (item.archivedAt !== null) return null;
	return (
		<div className="flex flex-wrap items-center gap-3">
			<Link
				aria-label={t('occasions.editAria', { name: item.name })}
				className={linkClass}
				params={params}
				to="/occasions/$occasionId"
			>
				{t('occasions.edit')}
			</Link>
			<DeleteOccasionDialog
				announce={announce}
				label={t('occasions.deleteAria', { name: item.name })}
				occasion={item}
				onRemoved={removed}
			/>
		</div>
	);
}

/**
 * The occasions as a table: name (the link to the occasion), area, kind, template, sender and the
 * day of the last wave; whoever edits an area also gets the actions there. Archived occasions are
 * marked.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.areas All areas the user may read.
 * @param props.occasions The occasions to show.
 * @param props.onRemoved Called after an occasion is gone or archived.
 * @param props.senders The senders released to the areas.
 * @param props.templates The templates of the areas.
 * @returns The table.
 */
export function OccasionTable({
	announce,
	areas,
	occasions,
	onRemoved,
	senders,
	templates,
}: Readonly<{
	announce: Announce;
	areas: readonly Readonly<OccasionArea>[];
	occasions: readonly ListedOccasion[];
	onRemoved: (item: ListedOccasion, result: RemovedOccasion) => void;
	senders: readonly Readonly<SenderChoice>[];
	templates: readonly Readonly<TemplateChoice>[];
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
	const templateById = useMemo(
		() => new Map(templates.map((template) => [template.id, template.name])),
		[templates],
	);
	const senderById = useMemo(
		() => new Map(senders.map((sender) => [sender.id, sender.label])),
		[senders],
	);
	const showActions = areas.some(({ canEdit }) => canEdit);
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('occasions.empty')}</p>,
		[t],
	);
	return (
		<div className="overflow-x-auto">
			<Table
				aria-label={t('occasions.title')}
				className="w-full border-collapse outline-none data-focus-visible:outline-2 data-focus-visible:outline-blue-700"
			>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass} isRowHeader>
						{t('occasions.nameColumn')}
					</Column>
					<Column className={headerCellClass}>{t('occasions.areaColumn')}</Column>
					<Column className={headerCellClass}>{t('occasions.kindColumn')}</Column>
					<Column className={headerCellClass}>{t('occasions.templateColumn')}</Column>
					<Column className={headerCellClass}>{t('occasions.senderColumn')}</Column>
					<Column className={headerCellClass}>{t('occasions.lastWaveColumn')}</Column>
					{showActions ? (
						<Column className={headerCellClass}>{t('occasions.actions')}</Column>
					) : null}
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					items={occasions}
					renderEmptyState={renderEmptyState}
				>
					{(item) => {
						const area = areaById.get(item.areaId);
						return (
							<Row className={rowClass} id={item.id}>
								<Cell className={cellClass}>
									<OccasionLink id={item.id} name={item.name} />
									{item.archivedAt === null ? null : (
										<span className="ml-2 text-sm text-gray-700">{t('occasions.archived')}</span>
									)}
								</Cell>
								<Cell className={cellClass}>{area?.name}</Cell>
								<Cell className={cellClass}>{t(`occasions.kind.${item.kind}`)}</Cell>
								<Cell className={cellClass}>{templateById.get(item.templateId)}</Cell>
								<Cell className={cellClass}>{senderById.get(item.senderId)}</Cell>
								<Cell className={cellClass}>
									{item.lastWaveAt === null
										? t('occasions.none')
										: formatClubDate(item.lastWaveAt, locale)}
								</Cell>
								{showActions ? (
									<Cell className={cellClass}>
										{area?.canEdit === true ? (
											<OccasionActions announce={announce} item={item} onRemoved={onRemoved} />
										) : null}
									</Cell>
								) : null}
							</Row>
						);
					}}
				</TableBody>
			</Table>
		</div>
	);
}
