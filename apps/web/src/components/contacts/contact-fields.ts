import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import type { MessageKey } from '@/i18n/translate';
import { formatCalendarDate } from '@/server/contacts/calendar';
import type { ContactDetail, ProtectedValueField } from '@/server/contacts/contacts';

/** One line of a contact's details: the field's label and its value as shown, null without one. */
interface ContactFieldRow {
	readonly id: string;
	readonly label: string;
	readonly value: string | null;
}

/** The protected built-in fields, in the order of the details. */
const PROTECTED_ROWS = [
	'birthDate',
	'entryDate',
	'exitDate',
	'street',
	'postalCode',
	'city',
] as const satisfies readonly ProtectedValueField[];

/** The protected fields that hold a calendar date. */
const DATE_FIELDS: ReadonlySet<ProtectedValueField> = new Set([
	'birthDate',
	'entryDate',
	'exitDate',
]);

/** The base text fields both kinds have, in the order of the details. */
const BASE_ROWS = ['organization', 'firstName', 'lastName', 'email'] as const;

/**
 * A list as one value, or null when it is empty.
 *
 * @param values The values.
 * @returns The values joined by commas, or null.
 */
function listValue(values: readonly string[]): string | null {
	return values.length === 0 ? null : values.join(', ');
}

/**
 * The lines of the base fields, which every contact shows: number, names, address, gender and
 * groups (members) or tags (partners).
 *
 * @param contact The contact.
 * @param locale The UI language.
 * @returns The lines in order.
 */
function baseRows(contact: ContactDetail, locale: Locale): ContactFieldRow[] {
	const row = (id: string, label: MessageKey, value: string | null): ContactFieldRow => ({
		id,
		label: translate(locale, label),
		value,
	});
	const isMember = contact.kind === 'member';
	return [
		isMember
			? row('memberNumber', 'import.field.memberNumber', contact.memberNumber)
			: row('customerNumber', 'import.field.customerNumber', contact.customerNumber),
		...BASE_ROWS.map((field) => row(field, `import.field.${field}`, contact[field])),
		row('gender', 'import.field.gender', translate(locale, `import.gender.${contact.gender}`)),
		isMember
			? row('groups', 'import.field.groups', listValue(contact.groups))
			: row('tags', 'partner.tags', listValue(contact.tags)),
	];
}

/**
 * The lines of a contact's details: the base fields always, then the protected and custom values
 * the server delivered. Dates are calendar days and never pass through a time zone.
 *
 * @param contact The contact as the user may see it.
 * @param locale The UI language.
 * @returns The lines in order.
 */
function contactFieldRows(contact: ContactDetail, locale: Locale): ContactFieldRow[] {
	const protectedRows = PROTECTED_ROWS.flatMap((field): ContactFieldRow[] => {
		const value = contact.protectedValues[field];
		if (value === undefined) return [];
		const shown = DATE_FIELDS.has(field) ? formatCalendarDate(value, locale) : value;
		return [{ id: field, label: translate(locale, `import.field.${field}`), value: shown }];
	});
	const customRows = contact.customValues.map((custom): ContactFieldRow => ({
		id: `custom:${custom.id}`,
		label: custom.name,
		value: custom.type === 'date' ? formatCalendarDate(custom.value, locale) : custom.value,
	}));
	return [...baseRows(contact, locale), ...protectedRows, ...customRows];
}

export { contactFieldRows };
export type { ContactFieldRow };
