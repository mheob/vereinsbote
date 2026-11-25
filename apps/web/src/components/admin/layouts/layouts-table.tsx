import { Link } from '@tanstack/react-router';
import { useCallback, useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import type { LayoutListPage } from '@/functions/layouts';
import { useT } from '@/i18n/use-t';

import { DeleteLayoutDialog } from './delete-layout-dialog';

type ListedLayout = LayoutListPage['layouts'][number];

const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
const cellClass =
	'px-3 py-2 align-top outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';
const rowClass =
	'border-b border-gray-300 outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * The name of a layout as the link to its page.
 *
 * @param props The props.
 * @param props.id The layout.
 * @param props.name The name.
 * @returns The link.
 */
function LayoutLink({ id, name }: Readonly<{ id: string; name: string }>): ReactNode {
	const params = useMemo(() => ({ layoutId: id }), [id]);
	return (
		<Link className={linkClass} params={params} to="/admin/layouts/$layoutId">
			{name}
		</Link>
	);
}

/**
 * The actions on a layout: „Ersetzen“ (its page) and „Löschen“, which a layout in use does not
 * allow.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.item The layout.
 * @param props.usageId The id of the text that says how the layout is used.
 * @param props.onChanged Called after the list changed.
 * @returns The actions.
 */
function LayoutActions({
	announce,
	item,
	onChanged,
	usageId,
}: Readonly<{
	announce: Announce;
	item: ListedLayout;
	usageId: string;
	onChanged: () => void;
}>): ReactNode {
	const t = useT();
	const params = useMemo(() => ({ layoutId: item.id }), [item.id]);
	return (
		<div className="flex flex-wrap items-center gap-3">
			<Link
				aria-label={t('layouts.editAria', { name: item.name })}
				className={linkClass}
				params={params}
				to="/admin/layouts/$layoutId"
			>
				{t('layouts.edit')}
			</Link>
			<DeleteLayoutDialog
				announce={announce}
				describedBy={usageId}
				layout={item}
				onChanged={onChanged}
			/>
		</div>
	);
}

/**
 * How many templates use a layout, in words.
 *
 * @param usedBy The number.
 * @param t The translation function.
 * @returns The text.
 */
function usageText(usedBy: number, t: ReturnType<typeof useT>): string {
	if (usedBy === 0) return t('layouts.notUsed');
	return usedBy === 1 ? t('layouts.usedByOne') : t('layouts.usedBy', { count: usedBy });
}

/**
 * The layouts as a table: the name (the link to its page), how many templates use it and the
 * actions. A layout in use cannot be deleted.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.layouts The layouts.
 * @param props.onChanged Called after a layout was deleted or found in use, so the page loads it anew.
 * @returns The table.
 */
export function LayoutsTable({
	announce,
	layouts,
	onChanged,
}: Readonly<{
	announce: Announce;
	layouts: readonly ListedLayout[];
	onChanged: () => void;
}>): ReactNode {
	const t = useT();
	const prefix = useId();
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('layouts.empty')}</p>,
		[t],
	);
	return (
		<div className="overflow-x-auto">
			<Table
				aria-label={t('layouts.tableCaption')}
				className="w-full border-collapse outline-none data-focus-visible:outline-2 data-focus-visible:outline-blue-700"
			>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass} isRowHeader>
						{t('layouts.nameColumn')}
					</Column>
					<Column className={headerCellClass}>{t('layouts.usedColumn')}</Column>
					<Column className={headerCellClass}>{t('layouts.actions')}</Column>
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					items={layouts}
					renderEmptyState={renderEmptyState}
				>
					{(item) => {
						const usageId = `${prefix}-${item.id}`;
						return (
							<Row className={rowClass} id={item.id}>
								<Cell className={cellClass}>
									<LayoutLink id={item.id} name={item.name} />
								</Cell>
								<Cell className={cellClass}>
									<span id={usageId}>{usageText(item.usedBy, t)}</span>
								</Cell>
								<Cell className={cellClass}>
									<LayoutActions
										announce={announce}
										item={item}
										onChanged={onChanged}
										usageId={usageId}
									/>
								</Cell>
							</Row>
						);
					}}
				</TableBody>
			</Table>
		</div>
	);
}
