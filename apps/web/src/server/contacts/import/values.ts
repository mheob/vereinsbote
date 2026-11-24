/*
 * Cleaning and checking single values of an import. No server imports: the browser uses this
 * module for its suggestions and pre-checks, the server for the authoritative check.
 */
import type { Gender } from '@/server/contacts/fields';
import { isValidUserEmail } from '@/server/users/form';

/** Values that count as empty by default: an empty cell and „-“. */
const DEFAULT_EMPTY_MARKERS = ['', '-'] as const;

/** Where a group value is split by default. */
const DEFAULT_GROUP_SEPARATORS = [',', ';'] as const;

/** The longest values the app takes (decision 10 of the plan). */
const MAX_LENGTH: Readonly<
	Record<'customText' | 'email' | 'group' | 'name' | 'number' | 'postalCode', number>
> = {
	customText: 500,
	email: 254,
	group: 100,
	name: 200,
	number: 50,
	postalCode: 20,
};

/** Line breaks and tabs: they separate words, so they become a space. */
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]+/gu;
const CONTROL_CHARACTERS = /\p{Cc}/gu;

const GENDER_WORDS: Readonly<Record<string, Gender>> = {
	d: 'diverse',
	divers: 'diverse',
	diverse: 'diverse',
	female: 'female',
	'keine angabe': 'unspecified',
	m: 'male',
	male: 'male',
	männlich: 'male',
	w: 'female',
	weiblich: 'female',
};

/**
 * Cleans a cell: composes umlauts (NFC), turns line breaks and tabs into spaces, removes other
 * control characters and trims.
 *
 * @param raw The cell, or null for a missing one.
 * @returns The cleaned text; empty for a missing cell.
 */
function cleanText(raw: string | null): string {
	if (raw === null) return '';
	return raw.normalize('NFC').replaceAll(BREAKS, ' ').replaceAll(CONTROL_CHARACTERS, '').trim();
}

/**
 * Tells whether a cleaned value counts as empty: an empty text or one of the markers.
 *
 * @param cleaned The value after `cleanText`.
 * @param markers The values that count as empty; spaces around them do not matter.
 * @returns True when the value is empty.
 */
function isEmptyValue(cleaned: string, markers: readonly string[]): boolean {
	return cleaned === '' || markers.some((marker) => cleanText(marker) === cleaned);
}

/**
 * Removes duplicates that differ only in case; the first spelling wins. Groups and partner tags
 * share this rule.
 *
 * @param values The values in their order.
 * @returns Each value once, in the order of first appearance.
 */
function uniqueIgnoringCase(values: readonly string[]): string[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const key = value.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Splits a group cell into groups: at each separator, trimmed, without empty values or markers,
 * each group once regardless of case.
 *
 * @param cleaned The value after `cleanText`.
 * @param separators The separators; an empty list keeps the value whole.
 * @param markers The values that count as empty.
 * @returns The groups in their order.
 */
function splitGroups(
	cleaned: string,
	separators: readonly string[],
	markers: readonly string[],
): string[] {
	let parts = [cleaned];
	for (const separator of separators) {
		if (separator !== '') parts = parts.flatMap((part) => part.split(separator));
	}
	return uniqueIgnoringCase(
		parts.map((part) => cleanText(part)).filter((part) => !isEmptyValue(part, markers)),
	);
}

/**
 * Suggests the gender for a value of an export, for the translation in the mapping.
 *
 * @param cleaned The value after `cleanText`.
 * @returns The gender, or null when the value says nothing known.
 */
function suggestGender(cleaned: string): Gender | null {
	const key = cleaned.toLowerCase();
	return Object.hasOwn(GENDER_WORDS, key) ? (GENDER_WORDS[key] ?? null) : null;
}

/**
 * Tells whether a cleaned value is an address a contact can have: the rule of the user
 * addresses (with a domain, at most 254 characters).
 *
 * @param cleaned The value after `cleanText`.
 * @returns True for a valid address.
 */
function isValidContactEmail(cleaned: string): boolean {
	return isValidUserEmail(cleaned);
}

export {
	cleanText,
	DEFAULT_EMPTY_MARKERS,
	DEFAULT_GROUP_SEPARATORS,
	isEmptyValue,
	isValidContactEmail,
	MAX_LENGTH,
	splitGroups,
	suggestGender,
	uniqueIgnoringCase,
};
