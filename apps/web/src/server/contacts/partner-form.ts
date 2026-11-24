/*
 * The partner form: the checks the server makes and the browser repeats before sending, and the
 * rule for tags. No server imports: the browser uses this module too.
 */
import { z } from 'zod';

import { normalizeEmail } from '@/server/auth/email';
import { parseCalendarDate } from '@/server/contacts/calendar';
import { GENDERS } from '@/server/contacts/fields';
import type { CustomFieldType, Gender } from '@/server/contacts/fields';
import {
	cleanText,
	isValidContactEmail,
	MAX_LENGTH,
	uniqueIgnoringCase,
} from '@/server/contacts/import/values';

/** At most this many tags per partner. */
const MAX_TAGS = 20;
/** At most this many characters per tag. */
const MAX_TAG_LENGTH = 40;

/**
 * The longest text a request may carry in one field: above every field's limit, so a value that is
 * too long is refused as a field error; anything longer is no form the app sends.
 */
const MAX_PARTNER_INPUT_LENGTH = 1000;
/** At most this many tags per request; more than `MAX_TAGS` are refused as a field error. */
const MAX_TAG_INPUTS = 100;
/** At most this many custom values per request. */
const MAX_CUSTOM_INPUTS = 500;

/**
 * A field of the form that can have an error. `name` (organization, first and last name all
 * empty) is shown once, at the organization field ("Firma"); a custom field is `custom:<id>`.
 */
type PartnerField =
	| 'birthDate'
	| 'city'
	| 'customerNumber'
	| 'email'
	| 'firstName'
	| 'lastName'
	| 'name'
	| 'organization'
	| 'postalCode'
	| 'street'
	| 'tags'
	| `custom:${string}`;

/**
 * The form as typed. The protected fields and the custom fields are only sent when the user may
 * see them; a field that is not sent stays as it is.
 */
interface PartnerInput {
	readonly customerNumber: string;
	readonly organization: string;
	readonly firstName: string;
	readonly lastName: string;
	readonly email: string;
	readonly gender: Gender;
	readonly tags: readonly string[];
	readonly birthDate?: string;
	readonly street?: string;
	readonly postalCode?: string;
	readonly city?: string;
	/** Custom field id → value; an empty value removes it. */
	readonly custom?: Readonly<Record<string, string>>;
}

const inputText = z.string().max(MAX_PARTNER_INPUT_LENGTH);

/**
 * The partner form as a request carries it. It bounds the request only; the field rules are
 * `checkPartnerInput`'s, so a refused value comes back as a field error.
 */
const partnerInputSchema = z.object({
	birthDate: inputText.optional(),
	city: inputText.optional(),
	custom: z
		.record(z.uuid(), inputText)
		.refine((custom) => Object.keys(custom).length <= MAX_CUSTOM_INPUTS)
		.optional(),
	customerNumber: inputText,
	email: inputText,
	firstName: inputText,
	gender: z.enum(GENDERS),
	lastName: inputText,
	organization: inputText,
	postalCode: inputText.optional(),
	street: inputText.optional(),
	tags: z.array(inputText).max(MAX_TAG_INPUTS),
});

/** `taken` comes from the server only: another partner has the customer number. */
type PartnerFieldError = 'invalid' | 'required' | 'taken';

type PartnerFieldErrors = Partial<Record<PartnerField, PartnerFieldError>>;

/** A custom field as the check needs it. */
interface PartnerCustomField {
	readonly id: string;
	readonly type: CustomFieldType;
}

/** The text fields of the form, each with the check of its value. */
type ValueField = Exclude<PartnerField, 'name' | 'tags' | `custom:${string}`>;

/**
 * The values of a checked form as they are stored: cleaned, an address normalized, a date as
 * `YYYY-MM-DD`, null for an empty value. A protected field the form did not carry is left out.
 */
interface PartnerValues {
	readonly customerNumber: string | null;
	readonly organization: string | null;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly email: string | null;
	readonly gender: Gender;
	/** Cleaned and each once regardless of case; existing spellings are applied by the server. */
	readonly tags: readonly string[];
	readonly birthDate?: string | null;
	readonly street?: string | null;
	readonly postalCode?: string | null;
	readonly city?: string | null;
	/** Custom field id → value; null removes the value. */
	readonly custom: Readonly<Record<string, string | null>>;
}

type PartnerCheck =
	| { readonly ok: true; readonly values: PartnerValues }
	| { readonly ok: false; readonly errors: PartnerFieldErrors };

type Checked = { readonly ok: true; readonly value: string | null } | { readonly ok: false };

const INVALID: Checked = { ok: false };

/**
 * A text within a length limit.
 *
 * @param raw The value as typed.
 * @param max The limit.
 * @returns The cleaned value, null when empty, or invalid when too long.
 */
function textWithin(raw: string, max: number): Checked {
	const cleaned = cleanText(raw);
	if (cleaned.length > max) return INVALID;
	return { ok: true, value: cleaned === '' ? null : cleaned };
}

/**
 * An address.
 *
 * @param raw The value as typed.
 * @returns The normalized address, null when empty, or invalid.
 */
function emailValue(raw: string): Checked {
	const cleaned = cleanText(raw);
	if (cleaned === '') return { ok: true, value: null };
	return isValidContactEmail(cleaned) ? { ok: true, value: normalizeEmail(cleaned) } : INVALID;
}

/**
 * A calendar date in one of the forms `parseCalendarDate` reads.
 *
 * @param raw The value as typed.
 * @returns The date as `YYYY-MM-DD`, null when empty, or invalid.
 */
function dateValue(raw: string): Checked {
	const cleaned = cleanText(raw);
	if (cleaned === '') return { ok: true, value: null };
	const parsed = parseCalendarDate(cleaned);
	return parsed.ok ? parsed : INVALID;
}

/**
 * A name, an organization, a street or a city (decision 10 of the plan).
 *
 * @param raw The value as typed.
 * @returns The checked value.
 */
function nameValue(raw: string): Checked {
	return textWithin(raw, MAX_LENGTH.name);
}

const VALUE_CHECKS: Readonly<Record<ValueField, (raw: string) => Checked>> = {
	birthDate: dateValue,
	city: nameValue,
	customerNumber: (raw) => textWithin(raw, MAX_LENGTH.number),
	email: emailValue,
	firstName: nameValue,
	lastName: nameValue,
	organization: nameValue,
	postalCode: (raw) => textWithin(raw, MAX_LENGTH.postalCode),
	street: nameValue,
};

const VALUE_FIELDS = [
	'customerNumber',
	'organization',
	'firstName',
	'lastName',
	'email',
	'birthDate',
	'street',
	'postalCode',
	'city',
] as const satisfies readonly ValueField[];

/**
 * Cleans tags: trimmed and without control characters, empty ones removed, each once regardless
 * of case. A tag that matches an existing one takes its spelling; otherwise the first spelling
 * wins.
 *
 * @param tags The tags as typed.
 * @param existing The tags already given, in the spelling that counts.
 * @returns The tags in their order.
 */
function normalizeTags(tags: readonly string[], existing: readonly string[]): string[] {
	const spellings = new Map(uniqueIgnoringCase(existing).map((tag) => [tag.toLowerCase(), tag]));
	return uniqueIgnoringCase(
		tags
			.map((tag) => cleanText(tag))
			.filter((tag) => tag !== '')
			.map((tag) => spellings.get(tag.toLowerCase()) ?? tag),
	);
}

/**
 * Checks the custom values: a date field takes a date, a text field at most 500 characters.
 *
 * @param custom The values as typed, by field id.
 * @param customFields The custom fields the form knows.
 * @returns The checked values by field id and the refused fields (`custom:<id>`).
 */
function checkCustomValues(
	custom: Readonly<Record<string, string>>,
	customFields: readonly PartnerCustomField[],
): { values: Record<string, string | null>; errors: PartnerFieldErrors } {
	const values = new Map<string, string | null>();
	const errors: PartnerFieldErrors = {};
	for (const [id, raw] of Object.entries(custom)) {
		const field = customFields.find((customField) => customField.id === id);
		let checked = INVALID;
		if (field !== undefined) {
			checked = field.type === 'date' ? dateValue(raw) : textWithin(raw, MAX_LENGTH.customText);
		}
		if (checked.ok) values.set(id, checked.value);
		else errors[`custom:${id}`] = 'invalid';
	}
	return { errors, values: Object.fromEntries(values) };
}

/**
 * Checks the text fields the form carries.
 *
 * @param input The form as typed.
 * @returns The cleaned values of the carried fields and the refused fields.
 */
function checkValueFields(input: Readonly<PartnerInput>): {
	values: Partial<Record<ValueField, string | null>>;
	errors: PartnerFieldErrors;
} {
	const values: Partial<Record<ValueField, string | null>> = {};
	const errors: PartnerFieldErrors = {};
	for (const field of VALUE_FIELDS) {
		const raw = input[field];
		if (raw !== undefined) {
			const checked = VALUE_CHECKS[field](raw);
			if (checked.ok) values[field] = checked.value;
			else errors[field] = 'invalid';
		}
	}
	return { errors, values };
}

/**
 * Tells whether a value counts as empty: nothing is left after cleaning.
 *
 * @param raw The value as typed.
 * @returns True when it is empty.
 */
function isBlank(raw: string): boolean {
	return cleanText(raw) === '';
}

/**
 * The required fields that are empty: a name (organization, first or last name) and a customer
 * number or an address.
 *
 * @param input The form as typed.
 * @returns `name` and `email` as required when missing.
 */
function missingFields(input: Readonly<PartnerInput>): PartnerFieldErrors {
	const errors: PartnerFieldErrors = {};
	if ([input.organization, input.firstName, input.lastName].every((raw) => isBlank(raw))) {
		errors.name = 'required';
	}
	if (isBlank(input.customerNumber) && isBlank(input.email)) errors.email = 'required';
	return errors;
}

/**
 * Checks the form and cleans its values. Empty values count as missing.
 *
 * @param input The form as typed.
 * @param customFields The custom fields the form knows; a value for another field is invalid.
 * @returns The values to store, or the refused fields.
 */
function checkPartnerInput(
	input: Readonly<PartnerInput>,
	customFields: readonly PartnerCustomField[] = [],
): PartnerCheck {
	const fields = checkValueFields(input);
	const tags = normalizeTags(input.tags, []);
	const tagsInvalid = tags.length > MAX_TAGS || tags.some((tag) => tag.length > MAX_TAG_LENGTH);
	const custom = checkCustomValues(input.custom ?? {}, customFields);
	const errors: PartnerFieldErrors = {
		...fields.errors,
		...missingFields(input),
		...(tagsInvalid ? { tags: 'invalid' } : {}),
		...custom.errors,
	};
	if (Object.keys(errors).length > 0) return { errors, ok: false };
	const { values } = fields;
	return {
		ok: true,
		values: {
			...values,
			custom: custom.values,
			customerNumber: values.customerNumber ?? null,
			email: values.email ?? null,
			firstName: values.firstName ?? null,
			gender: input.gender,
			lastName: values.lastName ?? null,
			organization: values.organization ?? null,
			tags,
		},
	};
}

/**
 * The fields of the form the server refuses; the page shows each at its field, the browser
 * checks the same rules before sending. A taken customer number only the server knows.
 *
 * @param input The form as typed.
 * @param customFields The custom fields the form knows; a value for another field is invalid.
 * @returns The refused fields; empty when the form can be saved.
 */
function invalidPartnerFields(
	input: Readonly<PartnerInput>,
	customFields: readonly PartnerCustomField[] = [],
): PartnerFieldErrors {
	const checked = checkPartnerInput(input, customFields);
	return checked.ok ? {} : checked.errors;
}

export {
	checkPartnerInput,
	invalidPartnerFields,
	MAX_PARTNER_INPUT_LENGTH,
	MAX_TAG_LENGTH,
	MAX_TAGS,
	normalizeTags,
	partnerInputSchema,
};
export type {
	PartnerCheck,
	PartnerCustomField,
	PartnerField,
	PartnerFieldError,
	PartnerFieldErrors,
	PartnerInput,
	PartnerValues,
};
