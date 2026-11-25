import { Link, useRouter } from '@tanstack/react-router';
import { startTransition, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import type { TemplateArea, TemplateListPage } from '@/functions/templates';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';

import { DeleteTemplateDialog } from './delete-template-dialog';
import type { RemovedTemplate } from './delete-template-dialog';
import { DuplicateDialog } from './duplicate-dialog';

type ListedTemplate = TemplateListPage['templates'][number];

const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
const cellClass =
	'px-3 py-2 align-top outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';
const rowClass =
	'border-b border-gray-300 outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * The name of a template as the link to its page.
 *
 * @param props The props.
 * @param props.id The template.
 * @param props.name The name.
 * @returns The link.
 */
function TemplateLink({ id, name }: Readonly<{ id: string; name: string }>): ReactNode {
	const params = useMemo(() => ({ templateId: id }), [id]);
	return (
		<Link className={linkClass} params={params} to="/templates/$templateId">
			{name}
		</Link>
	);
}

/**
 * The actions on a template: „Duplizieren“ for who edits at least one area (the template's own
 * area needs only `read`, Design 9), and „Bearbeiten“ and „Löschen“ for who edits its area.
 * Duplicating opens the copy; deleting announces and reloads the list.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.canEdit Whether the user may edit the template's area.
 * @param props.editableAreas The areas the user may edit, for the copy.
 * @param props.item The template.
 * @param props.onRemoved Called after the template is gone.
 * @returns The actions.
 */
function TemplateActions({
	announce,
	canEdit,
	editableAreas,
	item,
	onRemoved,
}: Readonly<{
	announce: Announce;
	canEdit: boolean;
	editableAreas: readonly TemplateArea[];
	item: ListedTemplate;
	onRemoved: (item: ListedTemplate, result: RemovedTemplate) => void;
}>): ReactNode {
	const t = useT();
	const router = useRouter();
	const params = useMemo(() => ({ templateId: item.id }), [item.id]);
	const source = useMemo(
		() => ({ areaId: item.areaId, id: item.id, name: item.name }),
		[item.areaId, item.id, item.name],
	);
	const onCopied = useCallback(
		(id: string, name: string) => {
			startTransition(async () => {
				await router.navigate({
					params: { templateId: id },
					state: { templateNotice: { kind: 'copied', name } },
					to: '/templates/$templateId',
				});
			});
		},
		[router],
	);
	const reload = useCallback(() => {
		startTransition(async () => router.invalidate());
	}, [router]);
	const removed = useCallback(
		(result: RemovedTemplate) => {
			onRemoved(item, result);
		},
		[item, onRemoved],
	);
	return (
		<div className="flex flex-wrap items-center gap-3">
			{canEdit ? (
				<Link
					aria-label={t('templates.editAria', { name: item.name })}
					className={linkClass}
					params={params}
					to="/templates/$templateId"
				>
					{t('templates.edit')}
				</Link>
			) : null}
			<DuplicateDialog
				announce={announce}
				areas={editableAreas}
				label={t('templates.duplicateAria', { name: item.name })}
				onCopied={onCopied}
				onGone={reload}
				source={source}
			/>
			{canEdit ? (
				<DeleteTemplateDialog
					announce={announce}
					label={t('templates.deleteAria', { name: item.name })}
					onRemoved={removed}
					template={item}
				/>
			) : null}
		</div>
	);
}

/**
 * The templates as a table: name (the link to the template), area, type (blocks or HTML) and the
 * day of the last change; whoever edits an area also gets the actions (copying from any readable
 * area, changing and deleting in the areas they edit).
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.areas All areas the user may read.
 * @param props.onRemoved Called after a template is gone.
 * @param props.templates The templates to show.
 * @returns The table.
 */
export function TemplateTable({
	announce,
	areas,
	onRemoved,
	templates,
}: Readonly<{
	announce: Announce;
	areas: readonly TemplateArea[];
	onRemoved: (item: ListedTemplate, result: RemovedTemplate) => void;
	templates: readonly ListedTemplate[];
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const editableAreas = useMemo(() => areas.filter(({ canEdit }) => canEdit), [areas]);
	const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
	const showActions = editableAreas.length > 0;
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('templates.empty')}</p>,
		[t],
	);
	return (
		<div className="overflow-x-auto">
			<Table
				aria-label={t('templates.title')}
				className="w-full border-collapse outline-none data-focus-visible:outline-2 data-focus-visible:outline-blue-700"
			>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass} isRowHeader>
						{t('templates.nameColumn')}
					</Column>
					<Column className={headerCellClass}>{t('templates.areaColumn')}</Column>
					<Column className={headerCellClass}>{t('templates.kindColumn')}</Column>
					<Column className={headerCellClass}>{t('templates.updatedAtColumn')}</Column>
					{showActions ? (
						<Column className={headerCellClass}>{t('templates.actions')}</Column>
					) : null}
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					items={templates}
					renderEmptyState={renderEmptyState}
				>
					{(item) => {
						const area = areaById.get(item.areaId);
						return (
							<Row className={rowClass} id={item.id}>
								<Cell className={cellClass}>
									<TemplateLink id={item.id} name={item.name} />
								</Cell>
								<Cell className={cellClass}>{area?.name}</Cell>
								<Cell className={cellClass}>{t(`templates.kind.${item.bodyKind}`)}</Cell>
								<Cell className={cellClass}>{formatClubDate(item.updatedAt, locale)}</Cell>
								{showActions ? (
									<Cell className={cellClass}>
										<TemplateActions
											announce={announce}
											canEdit={area?.canEdit === true}
											editableAreas={editableAreas}
											item={item}
											onRemoved={onRemoved}
										/>
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
