/*
 * The pieces of the mapping step that are no markup: the draft a file starts with, the keys of
 * the target select, the list of empty markers and the filter columns a file lacks.
 */
import { CONTACT_FIELDS } from '@/server/contacts/fields';
import type { ContactKind } from '@/server/contacts/fields';
import {
	DEFAULT_IMPORT_OPTIONS,
	isTargetOfKind,
	MAX_CUSTOM_FIELD_NAME_LENGTH,
	MAX_EMPTY_MARKERS,
	MAX_MARKER_LENGTH,
	suggestMapping,
} from '@/server/contacts/import/mapping';
import type { ColumnTarget, FilterRule, SavedMapping } from '@/server/contacts/import/mapping';
import { cleanText } from '@/server/contacts/import/values';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import type { MappingDraft } from './build-payload';

const FIELD_PREFIX = 'field:';
const CUSTOM_FIELD_PREFIX = 'customField:';
/** Empty markers are written and typed with this between them. */
const MARKER_SEPARATOR = ',';

/** What a key of the target select needs besides the key. */
interface TargetContext {
	readonly kind: ContactKind;
	/** The column header; a new custom field is named after it. */
	readonly header: string;
	/** The column's target so far; a new custom field keeps its name and type. */
	readonly current: ColumnTarget;
}

/**
 * The draft of a file: the targets the saved mapping or the headers suggest, the saved filters
 * and options, else the defaults. The organization rule applies to partners only.
 *
 * @param kind The contact kind.
 * @param headers The column headers of the file.
 * @param saved The mapping of the last confirmed import, or null.
 * @param customFields The custom fields.
 * @returns The draft.
 */
// oxlint-disable-next-line max-params -- mirrors `suggestMapping`
function initialDraft(
	kind: ContactKind,
	headers: readonly string[],
	saved: SavedMapping | null,
	customFields: readonly Readonly<CustomFieldRecord>[],
): MappingDraft {
	const columns = suggestMapping(headers, kind, saved, customFields);
	if (saved === null) return { columns, filters: [], options: DEFAULT_IMPORT_OPTIONS };
	return {
		columns,
		filters: saved.filters,
		options: {
			...saved.options,
			organizationFromLastName: kind === 'partner' && saved.options.organizationFromLastName,
		},
	};
}

/**
 * The key of a target in the select of a column.
 *
 * @param target The target.
 * @returns The key.
 */
function targetKey(target: ColumnTarget): string {
	if (target.type === 'field') return `${FIELD_PREFIX}${target.field}`;
	if (target.type === 'customField') return `${CUSTOM_FIELD_PREFIX}${target.customFieldId}`;
	return target.type;
}

/** The form of a UUID, the id of a custom field. */
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;

/**
 * A new custom field for a column: the one it has, else one named after the column, up to the
 * longest name a custom field may have.
 *
 * @param context The column and its target so far.
 * @returns The target.
 */
function newCustomFieldFor(context: TargetContext): ColumnTarget {
	if (context.current.type === 'newCustomField') return context.current;
	const name = cleanText(context.header).slice(0, MAX_CUSTOM_FIELD_NAME_LENGTH);
	return { name, type: 'newCustomField', valueType: 'text' };
}

/**
 * The field or existing custom field a key names.
 *
 * @param key The key.
 * @param kind The contact kind.
 * @returns The target, or null for a key the kind has not.
 */
function namedTargetOfKey(key: string, kind: ContactKind): ColumnTarget | null {
	if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
		const customFieldId = key.slice(CUSTOM_FIELD_PREFIX.length);
		return UUID.test(customFieldId) ? { customFieldId, type: 'customField' } : null;
	}
	const field = CONTACT_FIELDS[kind].find((candidate) => key === `${FIELD_PREFIX}${candidate}`);
	return field === undefined ? null : { field, type: 'field' };
}

/**
 * The target a key of the select stands for. A new custom field is named after its column; one
 * that has a name keeps it.
 *
 * @param key The key.
 * @param context The kind, the column and its target so far.
 * @returns The target, or null for a key the kind has not.
 */
function targetOfKey(key: string, context: TargetContext): ColumnTarget | null {
	if (key === 'discard') return { type: 'discard' };
	if (key === 'newCustomField') return newCustomFieldFor(context);
	const target: ColumnTarget | null =
		key === 'groups' ? { type: 'groups' } : namedTargetOfKey(key, context.kind);
	return target !== null && isTargetOfKind(target, context.kind) ? target : null;
}

/**
 * Reads the empty markers as typed: between commas, cleaned, each once. An empty cell always
 * counts as empty.
 *
 * @param text The markers as typed.
 * @returns The markers, the empty one first; null for more or longer markers than a mapping takes.
 */
function parseEmptyMarkers(text: string): string[] | null {
	const typed = [
		...new Set(
			text
				.split(MARKER_SEPARATOR)
				.map((marker) => cleanText(marker))
				.filter((marker) => marker !== ''),
		),
	];
	const markers = ['', ...typed];
	const fits =
		markers.length <= MAX_EMPTY_MARKERS &&
		typed.every((marker) => marker.length <= MAX_MARKER_LENGTH);
	return fits ? markers : null;
}

/**
 * Writes the empty markers for the text field; the empty cell goes without saying.
 *
 * @param markers The markers.
 * @returns The markers between commas.
 */
function formatEmptyMarkers(markers: readonly string[]): string {
	return markers.filter((marker) => marker !== '').join(`${MARKER_SEPARATOR} `);
}

/**
 * The columns filter rules name that the file lacks. An `is` rule on such a column leaves out
 * every row.
 *
 * @param headers The column headers of the file.
 * @param filters The filter rules.
 * @returns Each missing column once, in rule order.
 */
function missingFilterColumns(
	headers: readonly string[],
	filters: readonly Readonly<FilterRule>[],
): string[] {
	const present = new Set(headers);
	return [...new Set(filters.map(({ column }) => column).filter((column) => !present.has(column)))];
}

export {
	formatEmptyMarkers,
	initialDraft,
	missingFilterColumns,
	parseEmptyMarkers,
	targetKey,
	targetOfKey,
};
