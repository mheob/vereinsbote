import { describe, expect, it } from 'vite-plus/test';

import { FAILED } from '@/components/settle';
import type { MessageKey, MessageParams } from '@/i18n/translate';
import type { ContactListPage } from '@/server/contacts/contacts';
import { CONTACTS_PAGE_SIZE } from '@/server/contacts/list-query';

import { applySearchResult } from './search-result';

/**
 * A page of results without rows; only the numbers count here.
 *
 * @param total The number of contacts found.
 * @param page The page.
 * @returns The page.
 */
function resultPage(total: number, page = 1): ContactListPage {
	return { canFilterExit: false, groups: [], items: [], page, tags: [], total };
}

/**
 * Applies a result and records what the list showed and announced.
 *
 * @param result The settled result.
 * @param pagedBy The direction of a page change, null for a search.
 * @returns The pages shown and the announcements as `<tone> <key> <params>`.
 */
function apply(
	result: ContactListPage | typeof FAILED | undefined,
	pagedBy: 'next' | 'previous' | null,
): { announced: string[]; shown: ContactListPage[] } {
	const announced: string[] = [];
	const shown: ContactListPage[] = [];
	applySearchResult(result, pagedBy, {
		announce: (text: string, tone: string) => {
			announced.push(`${tone} ${text}`);
		},
		show: (page: ContactListPage) => {
			shown.push(page);
		},
		t: (key: MessageKey, params?: MessageParams) =>
			params === undefined ? key : `${key} ${JSON.stringify(params)}`,
	});
	return { announced, shown };
}

describe(applySearchResult, () => {
	it('does nothing after a redirect, which leaves no result', () => {
		// The session ended: Start resolves the call without a value and the redirect takes over.
		expect(apply(undefined, null)).toStrictEqual({ announced: [], shown: [] });
		expect(apply(undefined, 'next')).toStrictEqual({ announced: [], shown: [] });
	});

	it('keeps the page and says so when the call failed', () => {
		expect(apply(FAILED, null)).toStrictEqual({
			announced: ['alert auth.requestFailed'],
			shown: [],
		});
	});

	it('shows the results of a search and announces their number', () => {
		const one = resultPage(1);
		expect(apply(one, null)).toStrictEqual({
			announced: ['status contacts.foundOne'],
			shown: [one],
		});
		const many = resultPage(45);
		expect(apply(many, null)).toStrictEqual({
			announced: ['status contacts.found {"total":45}'],
			shown: [many],
		});
	});

	it('shows a changed page and announces it with the number of pages', () => {
		const second = resultPage(CONTACTS_PAGE_SIZE * 2 + 1, 2);
		expect(apply(second, 'next')).toStrictEqual({
			announced: ['status contacts.pageShown {"page":2,"pages":3}'],
			shown: [second],
		});
	});
});
