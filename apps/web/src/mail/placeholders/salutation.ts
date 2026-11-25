/*
 * The salutation (`{{salutation}}`): one text per case, chosen by gender, name and organization.
 */
import type { Gender } from '@/server/contacts/fields';

import { parsePlaceholders } from './syntax';
import type { PlaceholderRef } from './syntax';

type SalutationForm = 'du' | 'sie';

/** The cases of the salutation, each with a text of its own. */
const SALUTATION_CASES = ['female', 'male', 'other', 'organization', 'noName'] as const;
type SalutationCase = (typeof SALUTATION_CASES)[number];
type SalutationTexts = Readonly<Record<SalutationCase, string>>;

/** The default texts; they end without a comma, the template sets it. */
const DEFAULT_SALUTATIONS: Readonly<Record<SalutationForm, SalutationTexts>> = {
	du: {
		female: 'Liebe {{contact.firstName}}',
		male: 'Lieber {{contact.firstName}}',
		noName: 'Hallo',
		organization: 'Sehr geehrte Damen und Herren',
		other: 'Hallo {{contact.firstName}}',
	},
	sie: {
		female: 'Sehr geehrte Frau {{contact.lastName}}',
		male: 'Sehr geehrter Herr {{contact.lastName}}',
		noName: 'Guten Tag',
		organization: 'Sehr geehrte Damen und Herren',
		other: 'Guten Tag {{contact.firstName}} {{contact.lastName}}',
	},
};

interface SalutationContact {
	gender: Gender;
	firstName: string | null;
	lastName: string | null;
	organization: string | null;
}

const GENDER_CASE: Readonly<Record<Gender, SalutationCase>> = {
	diverse: 'other',
	female: 'female',
	male: 'male',
	unspecified: 'other',
};

/**
 * Trims a name; empty counts as missing.
 *
 * @param value The name.
 * @returns The name, or an empty text.
 */
function nameOf(value: string | null): string {
	return value?.trim() ?? '';
}

interface Part {
	text: string;
	/** The part needs a name the contact lacks. */
	missing: boolean;
}

/**
 * The text of a placeholder in a salutation text.
 *
 * @param ref The placeholder.
 * @param names The values per placeholder key.
 * @returns The text and whether a needed name is missing.
 */
function partOfPlaceholder(
	ref: Readonly<PlaceholderRef>,
	names: ReadonlyMap<string, string>,
): Part {
	const value = names.get(ref.key) ?? '';
	if (value !== '') return { missing: false, text: value };
	return {
		missing: ref.fallback === null && ref.key !== 'contact.organization',
		text: ref.fallback ?? '',
	};
}

/**
 * Fills a salutation text with the contact's names in one pass.
 *
 * @param text The text of the case.
 * @param names The values per placeholder key.
 * @returns The salutation, or null when the text needs a name that is empty.
 */
function fill(text: string, names: ReadonlyMap<string, string>): string | null {
	const parsed = parsePlaceholders(text);
	if (!parsed.ok) return text;
	const parts = parsed.segments.map((segment) =>
		segment.kind === 'text'
			? { missing: false, text: segment.value }
			: partOfPlaceholder(segment.ref, names),
	);
	return parts.some(({ missing }) => missing) ? null : parts.map(({ text: part }) => part).join('');
}

/**
 * Trims a text and turns each run of spaces into one, so an empty optional name leaves no gap.
 *
 * @param text The text.
 * @returns The text without leading, trailing or double spaces.
 */
function collapseSpaces(text: string): string {
	return text
		.split(' ')
		.filter((word) => word !== '')
		.join(' ');
}

/**
 * The salutation of a contact. Firm, not a person: the organization is set and the first name is
 * empty. A text that needs a name the contact lacks gives way to the "no name" text.
 *
 * @param texts The texts of the template.
 * @param contact The contact.
 * @returns The salutation, without a comma, trimmed and without double spaces. Values are
 * inserted as they are, never evaluated.
 */
function salutationFor(texts: SalutationTexts, contact: Readonly<SalutationContact>): string {
	const names = new Map([
		['contact.firstName', nameOf(contact.firstName)],
		['contact.lastName', nameOf(contact.lastName)],
		['contact.organization', nameOf(contact.organization)],
	]);
	const isOrganization =
		names.get('contact.organization') !== '' && names.get('contact.firstName') === '';
	const text = texts[isOrganization ? 'organization' : GENDER_CASE[contact.gender]];
	return collapseSpaces(fill(text, names) ?? fill(texts.noName, names) ?? texts.noName);
}

export { DEFAULT_SALUTATIONS, SALUTATION_CASES, salutationFor };
export type { SalutationCase, SalutationForm, SalutationTexts };
