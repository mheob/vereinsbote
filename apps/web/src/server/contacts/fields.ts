/*
 * The fields of a contact and which of them are protected. No server imports: the browser uses
 * this module too.
 */

const CONTACT_KINDS = ['member', 'partner'] as const;
type ContactKind = (typeof CONTACT_KINDS)[number];

const GENDERS = ['female', 'male', 'diverse', 'unspecified'] as const;
type Gender = (typeof GENDERS)[number];

type ContactField =
	| 'birthDate'
	| 'city'
	| 'customerNumber'
	| 'email'
	| 'entryDate'
	| 'exitDate'
	| 'firstName'
	| 'gender'
	| 'lastName'
	| 'memberNumber'
	| 'organization'
	| 'postalCode'
	| 'street';

const MEMBER_FIELDS = [
	'memberNumber',
	'organization',
	'firstName',
	'lastName',
	'email',
	'gender',
	'birthDate',
	'entryDate',
	'exitDate',
	'street',
	'postalCode',
	'city',
] as const satisfies readonly ContactField[];

const PARTNER_FIELDS = [
	'customerNumber',
	'organization',
	'firstName',
	'lastName',
	'email',
	'gender',
	'birthDate',
	'street',
	'postalCode',
	'city',
] as const satisfies readonly ContactField[];

/** The fields each kind has: members have no customer number, partners no member number or dates of membership. */
const CONTACT_FIELDS: Readonly<Record<ContactKind, readonly ContactField[]>> = {
	member: MEMBER_FIELDS,
	partner: PARTNER_FIELDS,
};

/** The built-in fields that only users with a matching area see; the address counts as one. */
const BUILTIN_PROTECTED_FIELD_KEYS = ['address', 'birthDate', 'entryDate', 'exitDate'] as const;
type BuiltinProtectedField = (typeof BUILTIN_PROTECTED_FIELD_KEYS)[number];

const BUILTIN_PROTECTED_FIELDS: Readonly<Record<ContactKind, readonly BuiltinProtectedField[]>> = {
	member: ['birthDate', 'entryDate', 'exitDate', 'address'],
	partner: ['birthDate', 'address'],
};

/** A protected field: a built-in one or a custom field (`custom:<id>`). */
type FieldKey = BuiltinProtectedField | `custom:${string}`;

/**
 * The key of a custom field in the field protection.
 *
 * @param customFieldId The id of the custom field.
 * @returns The field key.
 */
function customFieldKey(customFieldId: string): FieldKey {
	return `custom:${customFieldId}`;
}

const PROTECTED_FIELD_OF: Readonly<Partial<Record<ContactField, BuiltinProtectedField>>> = {
	birthDate: 'birthDate',
	city: 'address',
	entryDate: 'entryDate',
	exitDate: 'exitDate',
	postalCode: 'address',
	street: 'address',
};

/**
 * The protected built-in field a contact field belongs to.
 *
 * @param field A contact field.
 * @returns The protected field, or null when the field is a base field.
 */
function protectedFieldOf(field: ContactField): BuiltinProtectedField | null {
	return PROTECTED_FIELD_OF[field] ?? null;
}

const CUSTOM_FIELD_TYPES = ['text', 'date'] as const;
type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** `base` fields show to everybody who sees contacts, `protected` ones follow the field protection. */
const PROTECTIONS = ['base', 'protected'] as const;
type Protection = (typeof PROTECTIONS)[number];

export {
	BUILTIN_PROTECTED_FIELD_KEYS,
	BUILTIN_PROTECTED_FIELDS,
	CONTACT_FIELDS,
	CONTACT_KINDS,
	CUSTOM_FIELD_TYPES,
	customFieldKey,
	GENDERS,
	PROTECTIONS,
	protectedFieldOf,
};
export type {
	BuiltinProtectedField,
	ContactField,
	ContactKind,
	CustomFieldType,
	FieldKey,
	Gender,
	Protection,
};
