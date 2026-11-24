import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';

import type { Announce } from '@/components/announcements';
import { searchContacts } from '@/functions/contacts';
import { useT } from '@/i18n/use-t';
import type { ContactListPage } from '@/server/contacts/contacts';
import type { ContactKind } from '@/server/contacts/fields';
import { pageCount } from '@/server/contacts/list-query';

import { ContactSearch } from './contact-search';
import type { ContactSearchCriteria } from './contact-search';
import { ContactPager, ContactTable } from './contact-table';
import type { PageDirection } from './contact-table';

const NO_CRITERIA: ContactSearchCriteria = { filters: {}, query: '' };

/** The step of a page change. */
const PAGE_STEP: Readonly<Record<PageDirection, number>> = { next: 1, previous: -1 };

/** The list as shown: the page, what it was searched with and how it was reached. */
type ListState = Readonly<{
	criteria: ContactSearchCriteria;
	pagedBy: PageDirection | null;
	result: ContactListPage;
}>;

/**
 * The contacts of one kind with search, filters and page change. Search, filters and page are
 * the component's state and go to the server by POST (`searchContacts`), never into the URL. The
 * number of results is announced after a search, the page after a page change; the first page
 * comes from the route's loader and is not announced.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.initial The first page without search or filters.
 * @param props.kind The kind of the list.
 * @returns The search, the table and the page change.
 */
export function ContactList({
	announce,
	initial,
	kind,
}: Readonly<{ announce: Announce; initial: ContactListPage; kind: ContactKind }>): ReactNode {
	const t = useT();
	const search = useServerFn(searchContacts);
	const [isPending, startPending] = useTransition();
	const [state, setState] = useState<ListState>({
		criteria: NO_CRITERIA,
		pagedBy: null,
		result: initial,
	});
	const load = useCallback(
		(criteria: ContactSearchCriteria, page: number, pagedBy: PageDirection | null) => {
			startPending(async () => {
				try {
					const result = await search({ data: { ...criteria, kind, page } });
					setState({ criteria, pagedBy, result });
					if (pagedBy !== null) {
						const pages = pageCount(result.total);
						announce(t('contacts.pageShown', { page: result.page, pages }), 'status');
					} else if (result.total === 1) {
						announce(t('contacts.foundOne'), 'status');
					} else {
						announce(t('contacts.found', { total: result.total }), 'status');
					}
				} catch {
					announce(t('auth.requestFailed'), 'alert');
				}
			});
		},
		[announce, kind, search, t],
	);
	const onSearch = useCallback(
		(criteria: ContactSearchCriteria) => {
			load(criteria, 1, null);
		},
		[load],
	);
	const onPage = useCallback(
		(direction: PageDirection) => {
			load(state.criteria, state.result.page + PAGE_STEP[direction], direction);
		},
		[load, state],
	);
	const { result } = state;
	return (
		<>
			<ContactSearch
				canFilterExit={result.canFilterExit}
				choices={kind === 'member' ? result.groups : result.tags}
				isPending={isPending}
				kind={kind}
				onSearch={onSearch}
			/>
			<ContactTable items={result.items} kind={kind} />
			<ContactPager
				isPending={isPending}
				onPage={onPage}
				page={result.page}
				pagedBy={state.pagedBy}
				pages={pageCount(result.total)}
			/>
		</>
	);
}
