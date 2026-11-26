/*
 * The search and the filters of the contact list as SQL conditions on `contacts`. The recipients
 * of a wave use the same ones (plan decision 15), so a selection finds exactly what the list
 * shows. The search covers base fields only; the one filter on a protected field (`exit`) is
 * the caller's to allow only for users who see the exit date.
 */
import { and, eq, gt, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { contacts, contactSuppressions } from '@/server/db/schema';

import { MAX_SEARCH_LENGTH } from './list-query';

/** Filters of the list; `exit` needs the right to see the members' exit date. */
interface ContactFilters {
	/** Members in this group. */
	readonly group?: string;
	/** Partners with this tag, ignoring case. */
	readonly tag?: string;
	readonly withoutEmail?: boolean;
	readonly suppressed?: boolean;
	/** `reached`: the exit date is today or earlier; `planned`: it is after today. */
	readonly exit?: 'reached' | 'planned';
}

/**
 * A pattern for `ILIKE` that finds the text anywhere and takes `\`, `%` and `_` literally.
 *
 * @param text The text to find.
 * @returns The pattern; `\` is the escape character of `LIKE`.
 */
function containsPattern(text: string): string {
	const escaped = text.replaceAll(/[%\\_]/gu, (char) => `\\${char}`);
	return `%${escaped}%`;
}

/**
 * The search over names, organization, e-mail and numbers; protected fields are never searched.
 *
 * @param query The search as typed.
 * @returns The condition, or undefined for an empty search.
 */
function searchCondition(query: string): SQL | undefined {
	const text = query.trim().slice(0, MAX_SEARCH_LENGTH);
	if (text === '') return undefined;
	const pattern = containsPattern(text);
	return or(
		// "First Last" covers the first and the last name on their own.
		ilike(sql`concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})`, pattern),
		ilike(contacts.organization, pattern),
		ilike(contacts.email, pattern),
		ilike(contacts.memberNumber, pattern),
		ilike(contacts.customerNumber, pattern),
	);
}

/** A suppression belongs to the contact of the same kind and `contact_key`. */
const suppressionOfContact = and(
	eq(contactSuppressions.kind, contacts.kind),
	eq(contactSuppressions.contactKey, contacts.contactKey),
);

/**
 * Whether the contact has a suppression. Only for conditions: in the selection of a query on one
 * table Drizzle leaves columns unqualified, and the inner columns would shadow the outer ones.
 */
const isSuppressed = sql`exists (select 1 from ${contactSuppressions} where ${suppressionOfContact})`;

/**
 * The conditions of the filters.
 *
 * @param filters The filters.
 * @param today Today in the club's time zone, for the exit.
 * @returns The conditions; undefined entries are ignored by `and`.
 */
function filterConditions(filters: ContactFilters, today: string): (SQL | undefined)[] {
	const { exit, group, suppressed, tag, withoutEmail } = filters;
	const exitCondition = {
		planned: gt(contacts.exitDate, today),
		reached: lte(contacts.exitDate, today),
	};
	return [
		group === undefined ? undefined : sql`${group} = any(${contacts.groups})`,
		tag === undefined
			? undefined
			: sql`exists (select 1 from unnest(${contacts.tags}) as tag(value) where lower(tag.value) = lower(${tag}))`,
		withoutEmail === true ? or(isNull(contacts.email), eq(contacts.email, '')) : undefined,
		suppressed === true ? isSuppressed : undefined,
		exit === undefined ? undefined : exitCondition[exit],
	];
}

export { filterConditions, searchCondition, suppressionOfContact };
export type { ContactFilters };
