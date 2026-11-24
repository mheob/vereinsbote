/*
 * Builds the payload of an import from a read file and the mapping: only the mapped columns and
 * only the rows inside the filters leave the browser. The names of the discarded columns go
 * along for the saved mapping, never their values.
 */
import type { ContactField, ContactKind, Gender } from '@/server/contacts/fields';
import {
	isTargetOfKind,
	MAX_GENDER_VALUES,
	rowPassesFilters,
} from '@/server/contacts/import/mapping';
import type { ColumnTarget, MappedTarget, SavedMapping } from '@/server/contacts/import/mapping';
import { MAX_IMPORT_ROWS } from '@/server/contacts/import/payload';
import type { ImportPayload } from '@/server/contacts/import/payload';
import {
	cleanText,
	isEmptyWith,
	suggestGender,
	toMarkerSet,
} from '@/server/contacts/import/values';

/** The mapping as the mapping step edits it; a confirmed import saves it as it is. */
type MappingDraft = SavedMapping;

/** Why a draft cannot be previewed yet. */
type BuildPayloadProblem = 'fieldMappedTwice' | 'keyNotMapped' | 'noRows' | 'tooManyRows';

type BuildPayloadResult =
	| Readonly<{ ok: true; payload: ImportPayload; filteredOut: number }>
	| Readonly<{ ok: false; problem: BuildPayloadProblem }>;

/** A sheet as this module reads it, see `Sheet` in `read-sheet.ts`. */
interface SheetData {
	readonly headers: readonly string[];
	readonly rows: readonly { readonly line: number; readonly cells: readonly (string | null)[] }[];
}

/** A value of the gender column and the gender it becomes, if any. */
interface GenderChoice {
	readonly value: string;
	readonly gender: Gender | null;
}

/** How many sample values a column shows. */
const SAMPLE_COUNT = 3;

const DISCARD: ColumnTarget = { type: 'discard' };
/** What `indexOf` returns when nothing matches. */
const NOT_FOUND = -1;

/**
 * The target of a column in a draft; a column the draft does not know is discarded.
 *
 * @param draft The draft.
 * @param header The column header.
 * @returns The target.
 */
function targetOf(draft: MappingDraft, header: string): ColumnTarget {
	return Object.hasOwn(draft.columns, header) ? (draft.columns[header] ?? DISCARD) : DISCARD;
}

/**
 * Tells whether the import can identify its contacts: members by member number, partners by
 * customer number or address (the server's rule).
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
 * The cells of a row by column header, for the filters.
 *
 * @param headers The column headers.
 * @param cells The cells of the row.
 * @returns The cells by header.
 */
function rowRecord(
	headers: readonly string[],
	cells: readonly (string | null)[],
): Record<string, string | null> {
	return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? null]));
}

/** Which values of a column count: how many at most, and which count as empty. */
interface ValueQuery {
	/** The empty markers; null leaves out only blank values. */
	readonly markers: ReadonlySet<string> | null;
	readonly max: number;
}

/**
 * The cleaned values of a column that are not empty, each once, in the order they appear.
 *
 * @param sheet The sheet.
 * @param header The column header.
 * @param query How many values at most, and which count as empty.
 * @returns The values.
 */
function columnValues(sheet: SheetData, header: string, query: ValueQuery): string[] {
	const index = sheet.headers.indexOf(header);
	if (index === NOT_FOUND) return [];
	const { markers, max } = query;
	const values = new Set<string>();
	for (const { cells } of sheet.rows) {
		if (values.size >= max) break;
		const cleaned = cleanText(cells[index] ?? null);
		const empty = markers === null ? cleaned === '' : isEmptyWith(cleaned, markers);
		if (!empty) values.add(cleaned);
	}
	return [...values];
}

/**
 * Up to `max` different sample values of a column, only in the browser (design 13).
 *
 * @param sheet The sheet.
 * @param header The column header.
 * @param max The most values; three by default.
 * @returns The cleaned values that are not blank, in the order they appear.
 */
function sampleValues(sheet: SheetData, header: string, max = SAMPLE_COUNT): string[] {
	return columnValues(sheet, header, { markers: null, max });
}

/**
 * The different values of a column, for the translation of the gender: cleaned as the server
 * cleans them, without empty values, at most `MAX_GENDER_VALUES` (what a mapping takes).
 *
 * @param sheet The sheet.
 * @param header The column header.
 * @param markers The values that count as empty.
 * @returns The values in the order they appear.
 */
function distinctValues(sheet: SheetData, header: string, markers: readonly string[]): string[] {
	return columnValues(sheet, header, { markers: toMarkerSet(markers), max: MAX_GENDER_VALUES });
}

/**
 * The values of the gender column and their genders: the one chosen in the draft, else the
 * suggestion for the value, else none (the server then warns, the gender stays unspecified).
 *
 * @param sheet The sheet.
 * @param draft The draft.
 * @returns One choice per value; empty without a gender column.
 */
function genderChoices(sheet: SheetData, draft: MappingDraft): GenderChoice[] {
	const header = sheet.headers.find((candidate) => {
		const target = targetOf(draft, candidate);
		return target.type === 'field' && target.field === 'gender';
	});
	if (header === undefined) return [];
	const chosen = draft.options.genderValues;
	return distinctValues(sheet, header, draft.options.emptyMarkers).map((value) => ({
		gender: Object.hasOwn(chosen, value) ? (chosen[value] ?? null) : suggestGender(value),
		value,
	}));
}

/**
 * The first problem of the mapped columns: the key is missing or a field is mapped twice.
 *
 * @param kind The contact kind.
 * @param columns The mapped columns.
 * @returns The problem, or null.
 */
function mappingProblem(
	kind: ContactKind,
	columns: readonly { readonly target: MappedTarget }[],
): BuildPayloadProblem | null {
	const fields = columns.flatMap(({ target }) => (target.type === 'field' ? [target.field] : []));
	if (!isKeyMapped(kind, fields)) return 'keyNotMapped';
	return new Set(fields).size === fields.length ? null : 'fieldMappedTwice';
}

/**
 * Builds the payload of a file: the mapped columns of the kind in file order, the rows inside the
 * filters with the cells of those columns, and the translation of each gender value of the file.
 * A row keeps its line in the file. Values are sent as read; the server cleans and checks them.
 *
 * @param kind The contact kind.
 * @param sheet The read file.
 * @param draft The mapping.
 * @returns The payload and how many rows the filters left out, or why there is none.
 */
function buildPayload(
	kind: ContactKind,
	sheet: SheetData,
	draft: MappingDraft,
): BuildPayloadResult {
	if (sheet.rows.length > MAX_IMPORT_ROWS) return { ok: false, problem: 'tooManyRows' };
	const indexed = sheet.headers.map((header, index) => ({
		header,
		index,
		target: targetOf(draft, header),
	}));
	const mapped = indexed.flatMap(({ header, index, target }) =>
		target.type !== 'discard' && isTargetOfKind(target, kind) ? [{ header, index, target }] : [],
	);
	const problem = mappingProblem(kind, mapped);
	if (problem !== null) return { ok: false, problem };
	const rows = sheet.rows.filter(({ cells }) =>
		rowPassesFilters(rowRecord(sheet.headers, cells), draft.filters, draft.options.emptyMarkers),
	);
	if (rows.length === 0) return { ok: false, problem: 'noRows' };
	const genderValues = Object.fromEntries(
		genderChoices(sheet, draft).flatMap(({ gender, value }) =>
			gender === null ? [] : [[value, gender]],
		),
	);
	return {
		filteredOut: sheet.rows.length - rows.length,
		ok: true,
		payload: {
			columns: mapped.map(({ header, target }) => ({ header, target })),
			discardedHeaders: indexed.flatMap(({ header, target }) =>
				target.type === 'discard' || !isTargetOfKind(target, kind) ? [header] : [],
			),
			filters: draft.filters,
			kind,
			options: { ...draft.options, genderValues },
			rows: rows.map(({ cells, line }) => ({
				cells: mapped.map(({ index }) => cells[index] ?? null),
				line,
			})),
		},
	};
}

export { buildPayload, distinctValues, genderChoices, sampleValues };
export type { BuildPayloadProblem, BuildPayloadResult, GenderChoice, MappingDraft, SheetData };
