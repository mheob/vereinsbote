/*
 * What the contact list takes from the browser: the page size, the bounds of a request and its
 * schema. No server imports: the browser uses this module too.
 */
import { z } from 'zod';

import { CONTACT_KINDS } from './fields';
import { MAX_LENGTH } from './import/values';
import { MAX_TAG_LENGTH } from './partner-form';

/** Contacts per page of the list (decision 8 of the plan). */
const CONTACTS_PAGE_SIZE = 50;

/** The search is cut to this many characters; the browser takes no more. */
const MAX_SEARCH_LENGTH = 100;

/** The last page a request may ask for: half a million contacts, far beyond any club. */
const MAX_LIST_PAGE = 10_000;

/**
 * The value of a filter that picks one entry, such as a group; an empty value is no filter, as
 * `'' = any(groups)` would match nothing.
 *
 * @param maxLength The longest value the app stores.
 * @returns The schema of an optional value.
 */
// oxlint-disable-next-line typescript/explicit-function-return-type -- zod's inferred type keeps the key optional
function choiceFilter(maxLength: number) {
	return z
		.string()
		.max(maxLength)
		.transform((value) => (value === '' ? undefined : value))
		.optional();
}

/** One page of a kind with search and filters, as the list page asks for it. */
const contactListQuerySchema = z.object({
	filters: z.object({
		exit: z.enum(['reached', 'planned']).optional(),
		group: choiceFilter(MAX_LENGTH.group),
		suppressed: z.boolean().optional(),
		tag: choiceFilter(MAX_TAG_LENGTH),
		withoutEmail: z.boolean().optional(),
	}),
	kind: z.enum(CONTACT_KINDS),
	page: z.int().min(1).max(MAX_LIST_PAGE),
	query: z.string().max(MAX_SEARCH_LENGTH),
});

/**
 * The number of pages a result fills; an empty result has one, empty page.
 *
 * @param total The number of contacts found.
 * @returns The pages.
 */
function pageCount(total: number): number {
	return Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
}

export { CONTACTS_PAGE_SIZE, contactListQuerySchema, MAX_LIST_PAGE, MAX_SEARCH_LENGTH, pageCount };
