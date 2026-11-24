/*
 * The authoritative check of the rows of an import: every cell cleaned and checked, the values
 * per contact field, the field issues (warnings) and the blocking issues. No server imports: the
 * browser may run it too, but only the server's result counts.
 */
import { normalizeEmail } from '@/server/auth/email';
import { parseCalendarDate } from '@/server/contacts/calendar';
import type { ContactField, ContactKind, CustomFieldType } from '@/server/contacts/fields';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import { MAX_CUSTOM_FIELD_NAME_LENGTH } from './mapping';
import type { ImportOptions, MappedTarget } from './mapping';
import { MAX_IMPORT_ROWS } from './payload';
import type { ImportPayload } from './payload';
import {
	cleanText,
	isEmptyWith,
	isValidContactEmail,
	MAX_LENGTH,
	splitGroupsWith,
	toMarkerSet,
	uniqueIgnoringCase,
} from './values';

/** A mapped field or custom field (`custom:<customFieldId>` or `custom:new:<name>`). */
type BlankKey = ContactField | `custom:${string}`;

/** A row as the import takes it. */
interface ImportedRow {
	readonly line: number;
	/** Valid values; null clears (organization rule); missing: not mapped, empty or a field issue. */
	readonly values: Readonly<Partial<Record<ContactField, string | null>>>;
	/** Null when no column is mapped to groups. */
	readonly groups: readonly string[] | null;
	/** `customFieldId` or `new:<name>` → value. */
	readonly custom: Readonly<Record<string, string>>;
	/** Mapped, but empty or with a field issue. */
	readonly blank: readonly BlankKey[];
}

type FieldIssueReason =
	| 'invalidDate'
	| 'invalidEmail'
	| 'tooLong'
	| 'twoDigitYear'
	| 'unknownGender';

/** A warning: the row is imported, the field stays empty. */
interface FieldIssue {
	readonly line: number;
	readonly column: string;
	readonly reason: FieldIssueReason;
}

/** An issue that stops the import until the file is corrected. */
type BlockingIssue =
	| { readonly reason: 'tooManyRows'; readonly count: number }
	/** Members: no member number column; partners: neither customer number nor email. */
	| { readonly reason: 'keyNotMapped' }
	| { readonly reason: 'fieldMappedTwice'; readonly field: ContactField }
	/** A custom field name that is empty, too long, taken or used twice, or an unknown field. */
	| { readonly reason: 'customFieldInvalid'; readonly column: string }
	| {
			readonly reason: 'memberNumberMissing' | 'numberTooLong' | 'partnerKeyMissing';
			readonly line: number;
	  }
	| { readonly reason: 'numberDuplicate'; readonly line: number; readonly firstLine: number };

interface TransformResult {
	readonly rows: readonly ImportedRow[];
	readonly fieldIssues: readonly FieldIssue[];
	readonly blocking: readonly BlockingIssue[];
}

/** How the cells of a column are read; `skip` for a custom field that blocks the import. */
type ColumnPlan =
	| { readonly type: 'field'; readonly header: string; readonly field: ContactField }
	| { readonly type: 'groups'; readonly header: string }
	| {
			readonly type: 'custom';
			readonly header: string;
			readonly key: string;
			readonly valueType: CustomFieldType;
	  }
	| { readonly type: 'skip'; readonly header: string };

type CustomTarget = Extract<MappedTarget, { type: 'customField' | 'newCustomField' }>;

/** The fields that identify a contact; a bad value blocks the import instead of warning. */
type NumberField = 'customerNumber' | 'memberNumber';

type Checked =
	| { readonly ok: true; readonly value: string }
	| { readonly ok: false; readonly reason: FieldIssueReason };

type FieldCheck = (cleaned: string, options: ImportOptions) => Checked;

/** What one cell adds to its row. */
interface CellResult {
	readonly value?: { readonly field: ContactField; readonly value: string };
	readonly custom?: { readonly key: string; readonly value: string };
	readonly groups?: readonly string[];
	readonly blank?: BlankKey;
	/** A contact field with a field issue, unlike an empty one. */
	readonly failed?: ContactField;
	readonly issue?: { readonly column: string; readonly reason: FieldIssueReason };
	readonly numberTooLong?: true;
}

/** A row with what the key check and the field issue list need. */
interface ReadRow {
	readonly row: ImportedRow;
	readonly failed: ReadonlySet<ContactField>;
	readonly numberTooLong: boolean;
	readonly issues: readonly FieldIssue[];
}

interface RowContext {
	readonly plans: readonly ColumnPlan[];
	readonly options: ImportOptions;
	/** The empty markers, cleaned once per import. */
	readonly emptyMarkers: ReadonlySet<string>;
	readonly hasGroups: boolean;
	readonly organizationRule: boolean;
}

const NOTHING: CellResult = {};

/**
 * A value within a length limit.
 *
 * @param cleaned The cleaned value.
 * @param max The limit.
 * @returns The value, or `tooLong`.
 */
function withinLength(cleaned: string, max: number): Checked {
	return cleaned.length > max ? { ok: false, reason: 'tooLong' } : { ok: true, value: cleaned };
}

/**
 * A calendar date.
 *
 * @param cleaned The cleaned value.
 * @returns The date as `YYYY-MM-DD`, or the reason it was refused.
 */
function checkDate(cleaned: string): Checked {
	const parsed = parseCalendarDate(cleaned);
	return parsed.ok ? parsed : { ok: false, reason: parsed.reason };
}

/**
 * An address, stored normalized.
 *
 * @param cleaned The cleaned value.
 * @returns The address, or the reason it was refused.
 */
function checkEmail(cleaned: string): Checked {
	if (cleaned.length > MAX_LENGTH.email) return { ok: false, reason: 'tooLong' };
	return isValidContactEmail(cleaned)
		? { ok: true, value: normalizeEmail(cleaned) }
		: { ok: false, reason: 'invalidEmail' };
}

/**
 * A gender, only through the translation of the mapping.
 *
 * @param cleaned The cleaned value.
 * @param options The options of the mapping.
 * @returns The gender, or `unknownGender`.
 */
function checkGender(cleaned: string, options: ImportOptions): Checked {
	const gender = Object.hasOwn(options.genderValues, cleaned)
		? options.genderValues[cleaned]
		: undefined;
	return gender === undefined
		? { ok: false, reason: 'unknownGender' }
		: { ok: true, value: gender };
}

/**
 * A name, an organization, a street or a city.
 *
 * @param cleaned The cleaned value.
 * @returns The value, or `tooLong`.
 */
function checkName(cleaned: string): Checked {
	return withinLength(cleaned, MAX_LENGTH.name);
}

const FIELD_CHECKS: Readonly<Record<Exclude<ContactField, NumberField>, FieldCheck>> = {
	birthDate: checkDate,
	city: checkName,
	email: checkEmail,
	entryDate: checkDate,
	exitDate: checkDate,
	firstName: checkName,
	gender: checkGender,
	lastName: checkName,
	organization: checkName,
	postalCode: (cleaned) => withinLength(cleaned, MAX_LENGTH.postalCode),
	street: checkName,
};

/**
 * Tells whether a field identifies a contact.
 *
 * @param field The field.
 * @returns True for the member and the customer number.
 */
function isNumberField(field: ContactField): field is NumberField {
	return field === 'memberNumber' || field === 'customerNumber';
}

/**
 * Tells whether the import can identify its contacts: members by member number, partners by
 * customer number or email.
 *
 * @param kind The contact kind.
 * @param fields The mapped fields.
 * @returns True when the key is mapped.
 */
function isKeyMapped(kind: ContactKind, fields: readonly ContactField[]): boolean {
	return kind === 'member'
		? fields.includes('memberNumber')
		: fields.includes('customerNumber') || fields.includes('email');
}

/**
 * Tells whether a new custom field may have a name: not empty, not too long, not taken.
 *
 * @param name The cleaned name.
 * @param ownFields The custom fields of the kind.
 * @returns True when the name can be used.
 */
function isFreeCustomFieldName(
	name: string,
	ownFields: readonly Readonly<CustomFieldRecord>[],
): boolean {
	const lower = name.toLowerCase();
	return (
		name !== '' &&
		name.length <= MAX_CUSTOM_FIELD_NAME_LENGTH &&
		!ownFields.some((customField) => customField.name.toLowerCase() === lower)
	);
}

/**
 * Plans a custom field column; an unknown field or an unusable name is skipped.
 *
 * @param header The column header.
 * @param target The target.
 * @param ownFields The custom fields of the kind.
 * @returns The plan.
 */
function planCustomColumn(
	header: string,
	target: CustomTarget,
	ownFields: readonly Readonly<CustomFieldRecord>[],
): ColumnPlan {
	if (target.type === 'customField') {
		const record = ownFields.find((customField) => customField.id === target.customFieldId);
		return record === undefined
			? { header, type: 'skip' }
			: { header, key: record.id, type: 'custom', valueType: record.type };
	}
	const name = cleanText(target.name);
	return isFreeCustomFieldName(name, ownFields)
		? { header, key: `new:${name}`, type: 'custom', valueType: target.valueType }
		: { header, type: 'skip' };
}

/**
 * Skips every column after the first that maps to the same custom field (new names without
 * case).
 *
 * @param plans The plans.
 * @returns The plans without repeated custom fields.
 */
function withoutRepeatedCustomFields(plans: readonly ColumnPlan[]): ColumnPlan[] {
	const seen = new Set<string>();
	return plans.map((plan) => {
		if (plan.type !== 'custom') return plan;
		const key = plan.key.toLowerCase();
		if (seen.has(key)) return { header: plan.header, type: 'skip' };
		seen.add(key);
		return plan;
	});
}

/**
 * Plans how each column is read.
 *
 * @param payload The payload.
 * @param customFields The existing custom fields.
 * @returns The plan per column.
 */
function planColumns(
	payload: ImportPayload,
	customFields: readonly Readonly<CustomFieldRecord>[],
): ColumnPlan[] {
	const ownFields = customFields.filter((customField) => customField.kind === payload.kind);
	return withoutRepeatedCustomFields(
		payload.columns.map(({ header, target }): ColumnPlan => {
			if (target.type === 'field') return { field: target.field, header, type: 'field' };
			if (target.type === 'groups') return { header, type: 'groups' };
			return planCustomColumn(header, target, ownFields);
		}),
	);
}

/**
 * The values that appear more than once.
 *
 * @param values The values.
 * @returns Each repeated value once, in order.
 */
function repeated<T>(values: readonly T[]): T[] {
	const seen = new Set<T>();
	const twice = new Set<T>();
	for (const value of values) {
		if (seen.has(value)) twice.add(value);
		else seen.add(value);
	}
	return [...twice];
}

/**
 * The blocking issues of the mapping itself.
 *
 * @param payload The payload.
 * @param plans The plan per column.
 * @returns The issues.
 */
function mappingIssues(payload: ImportPayload, plans: readonly ColumnPlan[]): BlockingIssue[] {
	const fields = payload.columns.flatMap(({ target }) =>
		target.type === 'field' ? [target.field] : [],
	);
	const keyIssue: BlockingIssue[] = isKeyMapped(payload.kind, fields)
		? []
		: [{ reason: 'keyNotMapped' }];
	return [
		...keyIssue,
		...repeated(fields).map((field): BlockingIssue => ({ field, reason: 'fieldMappedTwice' })),
		...plans.flatMap((plan): BlockingIssue[] =>
			plan.type === 'skip' ? [{ column: plan.header, reason: 'customFieldInvalid' }] : [],
		),
	];
}

/**
 * Reads a group cell.
 *
 * @param header The column header.
 * @param cleaned The cleaned, non-empty value.
 * @param context The options and the cleaned empty markers.
 * @returns The groups; a group over the limit is dropped with a field issue.
 */
function readGroups(header: string, cleaned: string, context: RowContext): CellResult {
	const separators = context.options.groupSeparators;
	const groups = splitGroupsWith(cleaned, separators, context.emptyMarkers);
	const fitting = groups.filter((group) => group.length <= MAX_LENGTH.group);
	if (fitting.length === groups.length) return { groups };
	return { groups: fitting, issue: { column: header, reason: 'tooLong' } };
}

/**
 * Reads a custom field cell.
 *
 * @param plan The plan of the column.
 * @param cleaned The cleaned, non-empty value.
 * @returns The value, or the blank key and the field issue.
 */
function readCustom(plan: Extract<ColumnPlan, { type: 'custom' }>, cleaned: string): CellResult {
	const checked =
		plan.valueType === 'date' ? checkDate(cleaned) : withinLength(cleaned, MAX_LENGTH.customText);
	if (checked.ok) return { custom: { key: plan.key, value: checked.value } };
	return {
		blank: `custom:${plan.key}`,
		issue: { column: plan.header, reason: checked.reason },
	};
}

/**
 * Reads a contact field cell. A number over the limit blocks the import instead of warning.
 *
 * @param plan The plan of the column.
 * @param cleaned The cleaned, non-empty value.
 * @param options The options of the mapping.
 * @returns The value, or the blank key and the issue.
 */
function readField(
	plan: Extract<ColumnPlan, { type: 'field' }>,
	cleaned: string,
	options: ImportOptions,
): CellResult {
	const { field } = plan;
	if (isNumberField(field)) {
		return cleaned.length > MAX_LENGTH.number
			? { blank: field, numberTooLong: true }
			: { value: { field, value: cleaned } };
	}
	const checked = FIELD_CHECKS[field](cleaned, options);
	if (checked.ok) return { value: { field, value: checked.value } };
	return { blank: field, failed: field, issue: { column: plan.header, reason: checked.reason } };
}

/**
 * Reads one cell; every cell is cleaned first, an empty one is blank.
 *
 * @param plan The plan of the cell's column.
 * @param raw The cell.
 * @param context The options and the cleaned empty markers.
 * @returns What the cell adds to its row.
 */
function readCell(plan: ColumnPlan, raw: string | null, context: RowContext): CellResult {
	if (plan.type === 'skip') return NOTHING;
	const cleaned = cleanText(raw);
	if (isEmptyWith(cleaned, context.emptyMarkers)) {
		if (plan.type === 'groups') return NOTHING;
		return { blank: plan.type === 'field' ? plan.field : `custom:${plan.key}` };
	}
	if (plan.type === 'groups') return readGroups(plan.header, cleaned, context);
	if (plan.type === 'custom') return readCustom(plan, cleaned);
	return readField(plan, cleaned, context.options);
}

/**
 * The partner organization rule: without a first name, the last name is the organization. A
 * mapped organization, or a first name or organization with a field issue, keep the row.
 *
 * @param row The row.
 * @param failed The fields with a field issue.
 * @returns The row after the rule.
 */
function withOrganizationRule(row: ImportedRow, failed: ReadonlySet<ContactField>): ImportedRow {
	const { values } = row;
	const withoutFirstName = values.firstName === undefined && !failed.has('firstName');
	const withoutOrganization = values.organization === undefined && !failed.has('organization');
	if (!withoutFirstName || !withoutOrganization || typeof values.lastName !== 'string') return row;
	return {
		...row,
		blank: row.blank.filter((key) => key !== 'organization'),
		values: { ...values, lastName: null, organization: values.lastName },
	};
}

/**
 * Puts the cells of a row together.
 *
 * @param line The line in the file.
 * @param results What each cell adds.
 * @param hasGroups Whether a column is mapped to groups.
 * @returns The row and what the key check needs.
 */
function assembleRow(
	line: number,
	results: readonly CellResult[],
	hasGroups: boolean,
): Omit<ReadRow, 'issues'> {
	const values: Partial<Record<ContactField, string | null>> = {};
	const custom: Record<string, string> = {};
	for (const result of results) {
		if (result.value !== undefined) values[result.value.field] = result.value.value;
		if (result.custom !== undefined) custom[result.custom.key] = result.custom.value;
	}
	const groups = hasGroups
		? uniqueIgnoringCase(results.flatMap((result) => result.groups ?? []))
		: null;
	const blank = [...new Set(results.flatMap((result) => result.blank ?? []))];
	return {
		failed: new Set(results.flatMap((result) => result.failed ?? [])),
		numberTooLong: results.some((result) => result.numberTooLong === true),
		row: { blank, custom, groups, line, values },
	};
}

/**
 * Reads a row of the payload.
 *
 * @param line The line in the file.
 * @param cells The cells, in the order of the columns.
 * @param context The plans and options.
 * @returns The row, its field issues and what the key check needs.
 */
function readRow(line: number, cells: readonly (string | null)[], context: RowContext): ReadRow {
	const results = context.plans.map((plan, index) => readCell(plan, cells[index] ?? null, context));
	const { row, failed, numberTooLong } = assembleRow(line, results, context.hasGroups);
	return {
		failed,
		issues: results.flatMap((result) =>
			result.issue === undefined ? [] : [{ ...result.issue, line }],
		),
		numberTooLong,
		row: context.organizationRule ? withOrganizationRule(row, failed) : row,
	};
}

/**
 * The issue of a row without its key.
 *
 * @param kind The contact kind.
 * @param row The row.
 * @returns `memberNumberMissing`, `partnerKeyMissing` without a valid email, or nothing.
 */
function missingKey(kind: ContactKind, row: ImportedRow): BlockingIssue[] {
	if (kind === 'member') return [{ line: row.line, reason: 'memberNumberMissing' }];
	return row.values.email === undefined ? [{ line: row.line, reason: 'partnerKeyMissing' }] : [];
}

/**
 * The blocking issues of the numbers: too long, missing (when the key is mapped) or repeated.
 *
 * @param kind The contact kind.
 * @param rows The read rows.
 * @param keyMapped Whether the key columns are mapped.
 * @returns The issues in row order.
 */
function keyIssues(
	kind: ContactKind,
	rows: readonly ReadRow[],
	keyMapped: boolean,
): BlockingIssue[] {
	const numberField = kind === 'member' ? 'memberNumber' : 'customerNumber';
	const firstLines = new Map<string, number>();
	return rows.flatMap(({ row, numberTooLong }): BlockingIssue[] => {
		if (numberTooLong) return [{ line: row.line, reason: 'numberTooLong' }];
		const number = row.values[numberField];
		if (typeof number !== 'string') return keyMapped ? missingKey(kind, row) : [];
		const firstLine = firstLines.get(number);
		if (firstLine !== undefined) return [{ firstLine, line: row.line, reason: 'numberDuplicate' }];
		firstLines.set(number, row.line);
		return [];
	});
}

/**
 * Checks the rows of an import. Every cell is cleaned; an empty value is `blank`. Numbers are
 * the key and block the import when they are missing, too long or repeated; other invalid
 * values are field issues and stay empty.
 *
 * @param payload The decoded payload.
 * @param customFields The existing custom fields.
 * @returns The rows, the field issues and the blocking issues.
 */
function transformRows(
	payload: ImportPayload,
	customFields: readonly Readonly<CustomFieldRecord>[],
): TransformResult {
	if (payload.rows.length > MAX_IMPORT_ROWS) {
		return {
			blocking: [{ count: payload.rows.length, reason: 'tooManyRows' }],
			fieldIssues: [],
			rows: [],
		};
	}
	const plans = planColumns(payload, customFields);
	const mappingBlocking = mappingIssues(payload, plans);
	const context: RowContext = {
		emptyMarkers: toMarkerSet(payload.options.emptyMarkers),
		hasGroups: plans.some((plan) => plan.type === 'groups'),
		options: payload.options,
		organizationRule: payload.kind === 'partner' && payload.options.organizationFromLastName,
		plans,
	};
	const read = payload.rows.map(({ line, cells }) => readRow(line, cells, context));
	const keyMapped = !mappingBlocking.some((issue) => issue.reason === 'keyNotMapped');
	return {
		blocking: [...mappingBlocking, ...keyIssues(payload.kind, read, keyMapped)],
		fieldIssues: read.flatMap(({ issues }) => issues),
		rows: read.map(({ row }) => row),
	};
}

export { transformRows };
export type { BlankKey, BlockingIssue, FieldIssue, FieldIssueReason, ImportedRow, TransformResult };
