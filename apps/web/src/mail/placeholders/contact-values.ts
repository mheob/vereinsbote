/*
 * The values a contact gives to the placeholders. Which ones it gives depends on the delivered
 * protected fields: a protected field the area may not see is missing.
 */
import { customPlaceholderKey } from '@/mail/placeholders/registry';
import { formatCalendarDate } from '@/server/contacts/calendar';
import { displayName } from '@/server/contacts/display-name';
import { customFieldKey } from '@/server/contacts/fields';
import type { FieldKey } from '@/server/contacts/fields';
import type { CustomFieldRecord } from '@/server/contacts/settings';
import type { ContactRecord } from '@/server/db/schema';

import { salutationFor } from './salutation';
import type { SalutationTexts } from './salutation';

type ContactValueSource = Readonly<
	Omit<
		Pick<
			ContactRecord,
			| 'kind'
			| 'firstName'
			| 'lastName'
			| 'organization'
			| 'email'
			| 'memberNumber'
			| 'customerNumber'
			| 'gender'
			| 'groups'
			| 'tags'
			| 'birthDate'
			| 'entryDate'
			| 'exitDate'
			| 'street'
			| 'postalCode'
			| 'city'
			| 'customValues'
		>,
		'groups' | 'tags' | 'customValues'
	> & {
		groups: readonly string[];
		tags: readonly string[];
		customValues: Readonly<Record<string, string>>;
	}
>;

type Entry = readonly [key: string, value: string | null];

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Formats a stored calendar date the German way; a value that is no date stays as it is.
 *
 * @param value The date as `YYYY-MM-DD`, or null.
 * @returns `TT.MM.JJJJ`, or null.
 */
function germanDate(value: string | null): string | null {
	if (value === null || !CALENDAR_DATE.test(value)) return value;
	try {
		return formatCalendarDate(value, 'de');
	} catch {
		return value;
	}
}

/**
 * The values everybody who sees contacts gets.
 *
 * @param contact The contact.
 * @returns The entries.
 */
function baseEntries(contact: ContactValueSource): Entry[] {
	return [
		['contact.firstName', contact.firstName],
		['contact.lastName', contact.lastName],
		['contact.organization', contact.organization],
		['contact.displayName', displayName(contact).primary],
		['contact.email', contact.email],
		['contact.memberNumber', contact.memberNumber],
		['contact.customerNumber', contact.customerNumber],
		['contact.groups', contact.groups.join(', ')],
		['contact.tags', contact.tags.join(', ')],
	];
}

/**
 * The values of the built-in protected fields the area may see.
 *
 * @param contact The contact.
 * @param delivered The protected fields the area may see.
 * @returns The entries.
 */
function protectedEntries(contact: ContactValueSource, delivered: ReadonlySet<FieldKey>): Entry[] {
	const entries: Entry[] = [];
	if (delivered.has('birthDate'))
		entries.push(['contact.birthDate', germanDate(contact.birthDate)]);
	if (delivered.has('entryDate'))
		entries.push(['contact.entryDate', germanDate(contact.entryDate)]);
	if (delivered.has('exitDate')) entries.push(['contact.exitDate', germanDate(contact.exitDate)]);
	if (delivered.has('address')) {
		entries.push(
			['contact.street', contact.street],
			['contact.postalCode', contact.postalCode],
			['contact.city', contact.city],
		);
	}
	return entries;
}

/**
 * The values of the contact's custom fields the area may see.
 *
 * @param contact The contact.
 * @param delivered The protected fields the area may see.
 * @param customFields The custom fields.
 * @returns The entries, by the stable key of the field.
 */
function customEntries(
	contact: ContactValueSource,
	delivered: ReadonlySet<FieldKey>,
	customFields: readonly Readonly<CustomFieldRecord>[],
): Entry[] {
	return customFields
		.filter((field) => field.kind === contact.kind)
		.filter((field) => field.protection === 'base' || delivered.has(customFieldKey(field.id)))
		.map((field): Entry => {
			const value = contact.customValues[field.id] ?? null;
			return [
				customPlaceholderKey(field.placeholderKey),
				field.type === 'date' ? germanDate(value) : value,
			];
		});
}

/**
 * The placeholder values of a contact. Empty values are left out.
 *
 * @param contact The contact.
 * @param delivered The protected fields the area may see.
 * @param customFields The custom fields (those of the contact's kind count).
 * @param salutation The salutation texts of the template.
 * @returns The value per placeholder key. `salutation` is always set.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
function contactPlaceholderValues(
	contact: ContactValueSource,
	delivered: ReadonlySet<FieldKey>,
	customFields: readonly Readonly<CustomFieldRecord>[],
	salutation: SalutationTexts,
): Map<string, string> {
	const entries = [
		...baseEntries(contact),
		...protectedEntries(contact, delivered),
		...customEntries(contact, delivered, customFields),
	];
	const values = new Map<string, string>();
	for (const [key, value] of entries) {
		const text = value?.trim() ?? '';
		if (text !== '') values.set(key, text);
	}
	values.set('salutation', salutationFor(salutation, contact));
	return values;
}

export { contactPlaceholderValues };
export type { ContactValueSource };
