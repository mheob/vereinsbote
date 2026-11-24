import { describe, expect, it } from 'vite-plus/test';

import {
	CONTACTS_PAGE_SIZE,
	contactListQuerySchema,
	MAX_LIST_PAGE,
	MAX_SEARCH_LENGTH,
	pageCount,
} from './list-query';

/** A request of the list page as the browser sends it. */
const REQUEST = {
	filters: { exit: 'planned', group: 'Fußball', suppressed: true, withoutEmail: false },
	kind: 'member',
	page: 2,
	query: 'Lena',
} as const;

describe('the contact list query', () => {
	it('takes a query with search and filters as sent', () => {
		expect(contactListQuerySchema.parse(REQUEST)).toStrictEqual(REQUEST);
		expect(
			contactListQuerySchema.parse({ filters: {}, kind: 'partner', page: 1, query: '' }),
		).toStrictEqual({ filters: {}, kind: 'partner', page: 1, query: '' });
	});

	it('takes an empty group or tag as no filter', () => {
		const parsed = contactListQuerySchema.parse({
			filters: { group: '', tag: '' },
			kind: 'partner',
			page: 1,
			query: '',
		});
		expect(parsed.filters.group).toBeUndefined();
		expect(parsed.filters.tag).toBeUndefined();
		expect(
			contactListQuerySchema.parse({ ...REQUEST, filters: { tag: 'Presse' } }).filters.tag,
		).toBe('Presse');
	});

	it.each([0, -1, 1.5, MAX_LIST_PAGE + 1, Number.NaN, '2'])('refuses the page %s', (page) => {
		expect(contactListQuerySchema.safeParse({ ...REQUEST, page }).success).toBe(false);
	});

	it('takes the pages from 1 to the bound', () => {
		expect(contactListQuerySchema.parse({ ...REQUEST, page: 1 }).page).toBe(1);
		expect(contactListQuerySchema.parse({ ...REQUEST, page: MAX_LIST_PAGE }).page).toBe(
			MAX_LIST_PAGE,
		);
	});

	it('refuses an unknown kind, exit or an overlong search', () => {
		expect(contactListQuerySchema.safeParse({ ...REQUEST, kind: 'user' }).success).toBe(false);
		expect(
			contactListQuerySchema.safeParse({ ...REQUEST, filters: { exit: 'soon' } }).success,
		).toBe(false);
		expect(
			contactListQuerySchema.safeParse({ ...REQUEST, query: 'x'.repeat(MAX_SEARCH_LENGTH + 1) })
				.success,
		).toBe(false);
		expect(
			contactListQuerySchema.parse({ ...REQUEST, query: 'x'.repeat(MAX_SEARCH_LENGTH) }).query,
		).toHaveLength(MAX_SEARCH_LENGTH);
		expect(
			contactListQuerySchema.safeParse({ ...REQUEST, filters: { group: 'g'.repeat(101) } }).success,
		).toBe(false);
	});
});

describe(pageCount, () => {
	it('counts the pages of a result, at least one', () => {
		expect(pageCount(0)).toBe(1);
		expect(pageCount(1)).toBe(1);
		expect(pageCount(CONTACTS_PAGE_SIZE)).toBe(1);
		expect(pageCount(CONTACTS_PAGE_SIZE + 1)).toBe(2);
		expect(pageCount(3 * CONTACTS_PAGE_SIZE)).toBe(3);
	});
});
