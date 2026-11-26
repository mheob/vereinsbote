import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button, Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import { linkClass, secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { ContactListItem } from '@/server/contacts/contacts';
import type { ContactKind } from '@/server/contacts/fields';

/** The direction of a page change. */
type PageDirection = 'next' | 'previous';

const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
const cellClass =
	'px-3 py-2 align-top outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';
const rowClass =
	'border-b border-gray-300 outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * The name of a contact as the link to its page.
 *
 * @param props The props.
 * @param props.id The contact.
 * @param props.name The name as the list shows it.
 * @returns The link.
 */
function ContactLink({ id, name }: Readonly<{ id: string; name: string }>): ReactNode {
	const params = useMemo(() => ({ contactId: id }), [id]);
	return (
		<Link className={linkClass} params={params} to="/contacts/$contactId">
			{name}
		</Link>
	);
}

/**
 * The status of a contact in the list: suppressed, its address marked invalid, both or none.
 *
 * @param item The contact.
 * @param t Translates.
 * @returns The text, or null.
 */
function statusOf(
	item: Readonly<Pick<ContactListItem, 'invalidEmail' | 'suppressed'>>,
	t: ReturnType<typeof useT>,
): string | null {
	const parts = [
		item.suppressed ? t('contacts.suppressed') : null,
		item.invalidEmail ? t('contacts.invalidEmail') : null,
	].filter((part) => part !== null);
	return parts.length === 0 ? null : parts.join(', ');
}

/**
 * One page of contacts: number, name as the link to the contact (with the contact person of an
 * organization below it), address, groups (members) or tags (partners) and whether the contact
 * is suppressed or its address marked invalid. Without contacts the table says so; that text is
 * the only place of it on the page.
 *
 * @param props The props.
 * @param props.items The contacts of the page.
 * @param props.kind The kind of the list.
 * @returns The table.
 */
export function ContactTable({
	items,
	kind,
}: Readonly<{ items: readonly ContactListItem[]; kind: ContactKind }>): ReactNode {
	const t = useT();
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('contacts.empty')}</p>,
		[t],
	);
	return (
		<div className="overflow-x-auto">
			<Table
				aria-label={t(`contacts.table.${kind}`)}
				className="w-full border-collapse outline-none data-focus-visible:outline-2 data-focus-visible:outline-blue-700"
			>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass}>{t('contacts.numberColumn')}</Column>
					<Column className={headerCellClass} isRowHeader>
						{t('contacts.nameColumn')}
					</Column>
					<Column className={headerCellClass}>{t('contacts.emailColumn')}</Column>
					<Column className={headerCellClass}>
						{t(kind === 'member' ? 'contacts.groupsColumn' : 'contacts.tagsColumn')}
					</Column>
					<Column className={headerCellClass}>{t('contacts.statusColumn')}</Column>
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					items={items}
					renderEmptyState={renderEmptyState}
				>
					{(item) => (
						<Row className={rowClass} id={item.id}>
							<Cell className={cellClass}>{item.number}</Cell>
							<Cell className={cellClass}>
								<ContactLink id={item.id} name={item.name.primary} />
								{item.name.secondary === null ? null : (
									<span className="block text-sm text-gray-700">{item.name.secondary}</span>
								)}
							</Cell>
							<Cell className={cellClass}>{item.email}</Cell>
							<Cell className={cellClass}>
								{(kind === 'member' ? item.groups : item.tags).join(', ')}
							</Cell>
							<Cell className={cellClass}>{statusOf(item, t)}</Cell>
						</Row>
					)}
				</TableBody>
			</Table>
		</div>
	);
}

/**
 * The page change below the list: „Vorherige Seite“, „Seite {page} von {pages}“ and „Nächste
 * Seite“, only with more than one page. A button turns disabled at the first or last page; when
 * the pressed one does, the focus moves to the other instead of getting lost.
 *
 * @param props The props.
 * @param props.isPending Whether a page is loading.
 * @param props.onPage Called with the direction of a page change.
 * @param props.page The page shown.
 * @param props.pagedBy The direction that led to the page shown, or null after a search.
 * @param props.pages The number of pages.
 * @returns The page change, or nothing.
 */
export function ContactPager({
	isPending,
	onPage,
	page,
	pagedBy,
	pages,
}: Readonly<{
	isPending: boolean;
	onPage: (direction: PageDirection) => void;
	page: number;
	pagedBy: PageDirection | null;
	pages: number;
}>): ReactNode {
	const t = useT();
	const previousRef = useRef<HTMLButtonElement>(null);
	const nextRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (pagedBy === 'next' && page >= pages) previousRef.current?.focus();
		if (pagedBy === 'previous' && page <= 1) nextRef.current?.focus();
	}, [page, pagedBy, pages]);
	const onPrevious = useCallback(() => {
		onPage('previous');
	}, [onPage]);
	const onNext = useCallback(() => {
		onPage('next');
	}, [onPage]);
	if (pages <= 1) return null;
	return (
		<div className="flex flex-wrap items-center gap-4">
			<Button
				className={secondaryButtonClass}
				isDisabled={page <= 1}
				isPending={isPending}
				onPress={onPrevious}
				ref={previousRef}
			>
				{t('contacts.previousPage')}
			</Button>
			<p>{t('contacts.pageOf', { page, pages })}</p>
			<Button
				className={secondaryButtonClass}
				isDisabled={page >= pages}
				isPending={isPending}
				onPress={onNext}
				ref={nextRef}
			>
				{t('contacts.nextPage')}
			</Button>
		</div>
	);
}

export type { PageDirection };
