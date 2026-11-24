/*
 * The mapping of the columns of an import file: targets, options, filters and the suggestions.
 * No server imports: the browser uses this module for the mapping step.
 */
import { z } from 'zod';

import { CONTACT_FIELDS, CUSTOM_FIELD_TYPES, GENDERS } from '@/server/contacts/fields';
import type { ContactField, ContactKind, CustomFieldType, Gender } from '@/server/contacts/fields';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import {
	cleanText,
	DEFAULT_EMPTY_MARKERS,
	DEFAULT_GROUP_SEPARATORS,
	isEmptyWith,
	toMarkerSet,
} from './values';

/** Where the values of a column go. */
type MappedTarget =
	| { readonly type: 'field'; readonly field: ContactField }
	| { readonly type: 'groups' }
	| { readonly type: 'customField'; readonly customFieldId: string }
	| { readonly type: 'newCustomField'; readonly name: string; readonly valueType: CustomFieldType };

/** A column's target in the mapping; discarded columns never reach the server. */
type ColumnTarget = MappedTarget | { readonly type: 'discard' };

/** The longest name of a new custom field. */
const MAX_CUSTOM_FIELD_NAME_LENGTH = 60;

/*
 * Limits of a mapping. A real export has about a dozen columns, so they never bite; they keep the
 * server's check of a payload cheap, which cleans every cell and compares it with the markers.
 */
/** Columns of a file, mapped and discarded together. */
const MAX_COLUMNS = 200;
/** Characters of a column header, also where a filter rule names it. */
const MAX_HEADER_LENGTH = 200;
const MAX_EMPTY_MARKERS = 20;
const MAX_GROUP_SEPARATORS = 10;
/** Characters of an empty marker or a group separator. */
const MAX_MARKER_LENGTH = 10;
/** Values in the translation of the gender column. */
const MAX_GENDER_VALUES = 200;
const MAX_FILTER_RULES = 50;

/** A row is imported only when the column is (`is`) or is not (`isNot`) the value. */
interface FilterRule {
	readonly column: string;
	readonly operator: 'is' | 'isNot';
	readonly value: string;
}

/** How the cells of a file are read. */
interface ImportOptions {
	readonly emptyMarkers: readonly string[];
	readonly groupSeparators: readonly string[];
	/** The cleaned value of the gender column → the gender. */
	readonly genderValues: Readonly<Record<string, Gender>>;
	/** Partners only: a row without first name names an organization in its last name. */
	readonly organizationFromLastName: boolean;
}

const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
	emptyMarkers: DEFAULT_EMPTY_MARKERS,
	genderValues: {},
	groupSeparators: DEFAULT_GROUP_SEPARATORS,
	organizationFromLastName: false,
};

/** The mapping of a kind, saved with each confirmed import and suggested for the next one. */
interface SavedMapping {
	readonly columns: Readonly<Record<string, ColumnTarget>>;
	readonly filters: readonly FilterRule[];
	readonly options: ImportOptions;
}

const ALL_CONTACT_FIELDS: readonly ContactField[] = [
	...new Set([...CONTACT_FIELDS.member, ...CONTACT_FIELDS.partner]),
];

/** A name of a new custom field, cleaned like a cell. */
const customFieldNameSchema = z.string().overwrite((name) => cleanText(name));

const mappedTargetSchema = z.discriminatedUnion('type', [
	z.object({ field: z.enum(ALL_CONTACT_FIELDS), type: z.literal('field') }),
	z.object({ type: z.literal('groups') }),
	z.object({ customFieldId: z.uuid(), type: z.literal('customField') }),
	z.object({
		name: customFieldNameSchema,
		type: z.literal('newCustomField'),
		valueType: z.enum(CUSTOM_FIELD_TYPES),
	}),
]);

const columnTargetSchema = z.union([mappedTargetSchema, z.object({ type: z.literal('discard') })]);

const headerSchema = z.string().max(MAX_HEADER_LENGTH);
const markerSchema = z.string().max(MAX_MARKER_LENGTH);

const filterRuleSchema = z.object({
	column: headerSchema,
	operator: z.enum(['is', 'isNot']),
	value: z.string(),
});

const genderValuesSchema = z
	.record(z.string(), z.enum(GENDERS))
	.refine((values) => Object.keys(values).length <= MAX_GENDER_VALUES, {
		message: 'Too many gender values.',
	});

const importOptionsSchema = z.object({
	emptyMarkers: z.array(markerSchema).max(MAX_EMPTY_MARKERS),
	genderValues: genderValuesSchema,
	groupSeparators: z.array(markerSchema).max(MAX_GROUP_SEPARATORS),
	organizationFromLastName: z.boolean(),
});

const savedColumnsSchema = z
	.record(headerSchema, columnTargetSchema)
	.refine((columns) => Object.keys(columns).length <= MAX_COLUMNS, {
		message: 'Too many columns.',
	});

const savedMappingSchema: z.ZodType<SavedMapping> = z.object({
	columns: savedColumnsSchema,
	filters: z.array(filterRuleSchema).max(MAX_FILTER_RULES),
	options: importOptionsSchema,
});

type Suggestion = ContactField | 'groups' | ((kind: ContactKind) => ContactField);

/** Headers of known exports, trimmed, lowercase and without a final period. */
const HEADER_SUGGESTIONS: Readonly<Record<string, Suggestion>> = {
	abteilungen: 'groups',
	austritt: 'exitDate',
	'austritt am': 'exitDate',
	austrittsdatum: 'exitDate',
	'e-mail': 'email',
	'e-mail-adresse': 'email',
	eintritt: 'entryDate',
	eintrittsdatum: 'entryDate',
	email: 'email',
	firma: 'organization',
	geburtsdatum: 'birthDate',
	geburtstag: 'birthDate',
	geschlecht: 'gender',
	gruppen: 'groups',
	kundennummer: 'customerNumber',
	'mitglied bis': 'exitDate',
	'mitglied seit': 'entryDate',
	mitgliedsnummer: 'memberNumber',
	nachname: 'lastName',
	nr: (kind) => (kind === 'member' ? 'memberNumber' : 'customerNumber'),
	ort: 'city',
	plz: 'postalCode',
	status: 'groups',
	strasse: 'street',
	straße: 'street',
	vorname: 'firstName',
};

const DISCARD: ColumnTarget = { type: 'discard' };

/**
 * Tells whether a kind has a target: fields of the kind, groups for members only.
 *
 * @param target The target.
 * @param kind The contact kind of the import.
 * @returns True when the kind has it.
 */
function isTargetOfKind(target: ColumnTarget, kind: ContactKind): boolean {
	if (target.type === 'field') return CONTACT_FIELDS[kind].includes(target.field);
	if (target.type === 'groups') return kind === 'member';
	return true;
}

/**
 * Strips the dots at the end of a text (a pattern for it is quadratic on long runs of dots).
 *
 * @param text The text.
 * @returns The text without trailing dots.
 */
function withoutTrailingDots(text: string): string {
	let end = text.length;
	while (end > 0 && text.charAt(end - 1) === '.') end -= 1;
	return text.slice(0, end);
}

/**
 * Suggests a target from a column header of a known export.
 *
 * @param header The column header.
 * @param kind The contact kind of the import.
 * @returns The target; `discard` for an unknown header or a field the kind does not have.
 */
function suggestTarget(header: string, kind: ContactKind): ColumnTarget {
	const key = withoutTrailingDots(cleanText(header).toLowerCase());
	if (!Object.hasOwn(HEADER_SUGGESTIONS, key)) return DISCARD;
	const suggestion = HEADER_SUGGESTIONS[key];
	if (suggestion === undefined) return DISCARD;
	const target: ColumnTarget =
		suggestion === 'groups'
			? { type: 'groups' }
			: { field: typeof suggestion === 'function' ? suggestion(kind) : suggestion, type: 'field' };
	return isTargetOfKind(target, kind) ? target : DISCARD;
}

/**
 * Tells whether a saved target still applies: the kind has it and a saved custom field still
 * exists for this kind.
 *
 * @param target The saved target.
 * @param kind The contact kind of the import.
 * @param customFields The custom fields.
 * @returns True when the target can be suggested again.
 */
function isUsableSavedTarget(
	target: ColumnTarget,
	kind: ContactKind,
	customFields: readonly Readonly<CustomFieldRecord>[],
): boolean {
	if (!isTargetOfKind(target, kind)) return false;
	if (target.type !== 'customField') return true;
	return customFields.some(
		(customField) => customField.id === target.customFieldId && customField.kind === kind,
	);
}

/**
 * The saved targets that still apply, by column header.
 *
 * @param saved The saved mapping, or null.
 * @param kind The contact kind of the import.
 * @param customFields The custom fields.
 * @returns The targets.
 */
function usableSavedTargets(
	saved: SavedMapping | null,
	kind: ContactKind,
	customFields: readonly Readonly<CustomFieldRecord>[],
): Map<string, ColumnTarget> {
	if (saved === null) return new Map();
	return new Map(
		Object.entries(saved.columns).filter(([, target]) =>
			isUsableSavedTarget(target, kind, customFields),
		),
	);
}

/**
 * Suggests a target for each column: the saved one where it still applies, otherwise one from
 * the header. A field suggested from a header goes only to the first column that asks for it.
 *
 * @param headers The column headers of the file.
 * @param kind The contact kind of the import.
 * @param saved The mapping of the last confirmed import, or null.
 * @param customFields The custom fields.
 * @returns The target per header.
 */
// oxlint-disable-next-line max-params -- the interface of the plan, used by the mapping step
function suggestMapping(
	headers: readonly string[],
	kind: ContactKind,
	saved: SavedMapping | null,
	customFields: readonly Readonly<CustomFieldRecord>[],
): Record<string, ColumnTarget> {
	const savedTargets = usableSavedTargets(saved, kind, customFields);
	const used = new Set(
		headers.flatMap((header) => {
			const target = savedTargets.get(header);
			return target?.type === 'field' ? [target.field] : [];
		}),
	);
	const targets = headers.map((header): [string, ColumnTarget] => {
		const kept = savedTargets.get(header);
		if (kept !== undefined) return [header, kept];
		const suggested = suggestTarget(header, kind);
		if (suggested.type !== 'field') return [header, suggested];
		if (used.has(suggested.field)) return [header, DISCARD];
		used.add(suggested.field);
		return [header, suggested];
	});
	return Object.fromEntries(targets);
}

/**
 * Compares the columns of a file with the saved mapping.
 *
 * @param headers The column headers of the file.
 * @param saved The saved mapping.
 * @returns `missing`: mapped columns the file lacks; `added`: columns the mapping does not know.
 */
function mappingChanges(
	headers: readonly string[],
	saved: SavedMapping,
): { missing: string[]; added: string[] } {
	const present = new Set(headers);
	const missing = Object.entries(saved.columns)
		.filter(([header, target]) => target.type !== 'discard' && !present.has(header))
		.map(([header]) => header);
	const added = headers.filter((header) => !Object.hasOwn(saved.columns, header));
	return { added, missing };
}

/**
 * A value as the filters compare it: cleaned, empty markers as `''`, without case.
 *
 * @param raw The value.
 * @param markers The markers from `toMarkerSet`.
 * @returns The comparable value.
 */
function comparable(raw: string | null, markers: ReadonlySet<string>): string {
	const cleaned = cleanText(raw);
	return isEmptyWith(cleaned, markers) ? '' : cleaned.toLowerCase();
}

/**
 * Tells whether a row passes the filters: all rules must hold. Empty values count as `''`.
 *
 * @param row The cells of the row by column header.
 * @param filters The rules.
 * @param markers The values that count as empty.
 * @returns True when the row is imported.
 */
function rowPassesFilters(
	row: Readonly<Record<string, string | null>>,
	filters: readonly FilterRule[],
	markers: readonly string[],
): boolean {
	const markerSet = toMarkerSet(markers);
	return filters.every((rule) => {
		const cell = Object.hasOwn(row, rule.column) ? (row[rule.column] ?? null) : null;
		const equal = comparable(cell, markerSet) === comparable(rule.value, markerSet);
		return rule.operator === 'is' ? equal : !equal;
	});
}

export {
	DEFAULT_IMPORT_OPTIONS,
	filterRuleSchema,
	headerSchema,
	importOptionsSchema,
	isTargetOfKind,
	mappedTargetSchema,
	mappingChanges,
	MAX_COLUMNS,
	MAX_CUSTOM_FIELD_NAME_LENGTH,
	MAX_EMPTY_MARKERS,
	MAX_FILTER_RULES,
	MAX_GENDER_VALUES,
	MAX_GROUP_SEPARATORS,
	MAX_HEADER_LENGTH,
	MAX_MARKER_LENGTH,
	rowPassesFilters,
	savedMappingSchema,
	suggestMapping,
	suggestTarget,
};
export type { ColumnTarget, FilterRule, ImportOptions, MappedTarget, SavedMapping };
