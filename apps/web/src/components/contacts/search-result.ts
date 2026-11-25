import type { Announce } from '@/components/announcements';
import { FAILED } from '@/components/settle';
import type { Translate } from '@/i18n/translate';
import type { ContactListPage } from '@/server/contacts/contacts';
import { pageCount } from '@/server/contacts/list-query';

import type { PageDirection } from './contact-table';

/**
 * Takes the settled result of a search or a page change (`settle(searchContacts(…))`): shows the
 * page and announces it, the page after a page change, the number of results after a search. A
 * failed call keeps the page and says so. After a redirect (the session ended) the result is
 * undefined and nothing happens: the redirect takes over.
 *
 * @param result The settled result.
 * @param pagedBy The direction of a page change, null for a search.
 * @param list How the list shows a page, announces and translates.
 */
function applySearchResult(
	result: ContactListPage | typeof FAILED | undefined,
	pagedBy: PageDirection | null,
	list: Readonly<{ announce: Announce; show: (page: ContactListPage) => void; t: Translate }>,
): void {
	const { announce, show, t } = list;
	if (result === undefined) return;
	if (result === FAILED) {
		announce(t('auth.requestFailed'), 'alert');
		return;
	}
	show(result);
	if (pagedBy !== null) {
		announce(
			t('contacts.pageShown', { page: result.page, pages: pageCount(result.total) }),
			'status',
		);
	} else if (result.total === 1) {
		announce(t('contacts.foundOne'), 'status');
	} else {
		announce(t('contacts.found', { total: result.total }), 'status');
	}
}

export { applySearchResult };
