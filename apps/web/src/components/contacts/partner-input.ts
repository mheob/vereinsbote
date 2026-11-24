/*
 * The partner form in the browser: reading the submitted fields, the message of each refused
 * field and the tags. The rules themselves are the server's (`server/contacts/partner-form.ts`).
 */
import type { MessageKey } from '@/i18n/translate';
import { GENDERS } from '@/server/contacts/fields';
import type { Gender } from '@/server/contacts/fields';
import { normalizeTags } from '@/server/contacts/partner-form';
import type {
	PartnerFieldError,
	PartnerFieldErrors,
	PartnerInput,
} from '@/server/contacts/partner-form';
import type { PartnerProtectedField } from '@/server/contacts/partners';

/** The fields of the form besides the base fields: the protected and custom ones the user sees. */
type PartnerFormFields = Readonly<{
	protectedFields: readonly PartnerProtectedField[];
	customFields: readonly Readonly<{ id: string }>[];
}>;

/** A date field of the form and, per segment (day, month, year), whether it is typed. */
type DateFieldSegments = Readonly<{
	name: 'birthDate' | `custom:${string}`;
	segmentsFilled: readonly boolean[];
}>;

/** The base text fields, in form order. */
const BASE_FIELDS = ['customerNumber', 'organization', 'firstName', 'lastName', 'email'] as const;

/** The input of the tags; the tags themselves are the form's state. */
const TAGS_INPUT = 'tags';

/**
 * The name of a custom field's input, the same as the key of its error.
 *
 * @param id The custom field.
 * @returns The name.
 */
function customFieldName(id: string): `custom:${string}` {
	return `custom:${id}`;
}

/**
 * Reads a text field of the submitted form.
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The value, or an empty string.
 */
function textOf(formData: FormData, name: string): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

/**
 * Tells whether a value is a gender.
 *
 * @param value The value.
 * @returns True for a gender.
 */
function isGender(value: string): value is Gender {
	const genders: readonly string[] = GENDERS;
	return genders.includes(value);
}

/**
 * Reads the submitted form. Only the protected and custom fields the user sees are carried, so a
 * field the user does not see stays as it is on the server.
 *
 * @param formData The submitted form.
 * @param fields The protected and custom fields the user sees.
 * @param tags The tags as the form shows them.
 * @returns The form as typed.
 */
function readPartnerInput(
	formData: FormData,
	fields: PartnerFormFields,
	tags: readonly string[],
): PartnerInput {
	const shown: Partial<Record<PartnerProtectedField, string>> = {};
	for (const field of fields.protectedFields) shown[field] = textOf(formData, field);
	const gender = textOf(formData, 'gender');
	return {
		...shown,
		custom: Object.fromEntries(
			fields.customFields.map((field) => [field.id, textOf(formData, customFieldName(field.id))]),
		),
		customerNumber: textOf(formData, 'customerNumber'),
		email: textOf(formData, 'email'),
		firstName: textOf(formData, 'firstName'),
		gender: isGender(gender) ? gender : 'unspecified',
		lastName: textOf(formData, 'lastName'),
		organization: textOf(formData, 'organization'),
		tags: [...tags],
	};
}

/**
 * The message at a refused field.
 *
 * @param field The field, as `PartnerFieldErrors` names it.
 * @param error Why it was refused.
 * @returns The key of the message.
 */
function partnerFieldMessage(field: string, error: PartnerFieldError): MessageKey {
	if (field === 'name') return 'partner.nameRequired';
	if (error === 'required') return 'partner.keyRequired';
	return error === 'taken' ? 'partner.customerNumberTaken' : 'partner.invalid';
}

/**
 * The input that shows a field's error: a missing name shows once, at the organization ("Firma").
 *
 * @param field The field, as `PartnerFieldErrors` names it.
 * @returns The name of the input.
 */
function inputOf(field: string): string {
	return field === 'name' ? 'organization' : field;
}

/**
 * The messages of the refused fields by the name of the input that shows them.
 *
 * @param errors The refused fields.
 * @returns The key of the message per input.
 */
function partnerErrorMessages(
	errors: Readonly<PartnerFieldErrors>,
): Readonly<Record<string, MessageKey>> {
	const messages: Record<string, MessageKey> = {};
	for (const [field, error] of Object.entries(errors)) {
		if (error !== undefined) messages[inputOf(field)] = partnerFieldMessage(field, error);
	}
	return messages;
}

/**
 * The names of the form's inputs that can show an error, in form order.
 *
 * @param fields The protected and custom fields the user sees.
 * @returns The names.
 */
function partnerFieldOrder(fields: PartnerFormFields): string[] {
	return [
		...BASE_FIELDS,
		...fields.protectedFields,
		...fields.customFields.map((field) => customFieldName(field.id)),
		TAGS_INPUT,
	];
}

/**
 * The first input in form order that shows an error; it gets the focus.
 *
 * @param errors The refused fields.
 * @param order The names of the inputs in form order.
 * @returns The name, or null without an error the form shows.
 */
function firstInvalidField(
	errors: Readonly<PartnerFieldErrors>,
	order: readonly string[],
): string | null {
	const messages = partnerErrorMessages(errors);
	return order.find((name) => Object.hasOwn(messages, name)) ?? null;
}

/**
 * The date fields typed only in part, e.g. „17.05.“ without the year or a stored date with one
 * segment cleared. React Aria submits such a date as empty (or keeps the old one), so the form
 * refuses it at the field instead of saving something else.
 *
 * @param fields The date fields of the form with the state of their segments.
 * @returns The refused fields; empty when every date is complete or empty.
 */
function partlyTypedDates(fields: readonly DateFieldSegments[]): PartnerFieldErrors {
	const errors: PartnerFieldErrors = {};
	for (const { name, segmentsFilled } of fields) {
		if (segmentsFilled.includes(true) && segmentsFilled.includes(false)) errors[name] = 'invalid';
	}
	return errors;
}

/**
 * Adds a tag as typed: cleaned, once regardless of case, in the spelling of an existing tag.
 *
 * @param tags The tags of the form.
 * @param text The new tag as typed.
 * @param existing The tags of the partners, in the spelling that counts.
 * @returns The tags.
 */
function withTag(tags: readonly string[], text: string, existing: readonly string[]): string[] {
	return normalizeTags([...tags, text], existing);
}

/**
 * The suggestions for the tag input: the existing tags the partner does not have that contain
 * the typed text, both ignoring case.
 *
 * @param suggestions The tags of the partners.
 * @param tags The tags of the form.
 * @param input The typed text.
 * @returns The suggestions in their order.
 */
function tagSuggestionsFor(
	suggestions: readonly string[],
	tags: readonly string[],
	input: string,
): string[] {
	const taken = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
	const typed = input.trim().toLocaleLowerCase();
	return suggestions.filter((tag) => {
		const lower = tag.toLocaleLowerCase();
		return !taken.has(lower) && lower.includes(typed);
	});
}

export {
	customFieldName,
	firstInvalidField,
	partnerErrorMessages,
	partnerFieldMessage,
	partnerFieldOrder,
	partlyTypedDates,
	readPartnerInput,
	tagSuggestionsFor,
	withTag,
};
export type { DateFieldSegments, PartnerFormFields };
