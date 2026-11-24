import type { MessageKey } from '@/i18n/translate';
import { BUILTIN_PROTECTED_FIELD_KEYS, customFieldKey } from '@/server/contacts/fields';
import type { BuiltinProtectedField, FieldKey } from '@/server/contacts/fields';

/*
 * The rules of the table „Geschützte Felder“: which areas a field has after a tick and how the
 * page names fields and areas. No server imports: the browser uses this module.
 */

/** An area as the settings page lists it. */
type SettingsArea = Readonly<{ id: string; name: string }>;

/** A protected field of one kind with the areas that see it. */
type ProtectedFieldRow = Readonly<{
	key: FieldKey;
	/** The name of a custom field; null for a built-in field. */
	customName: string | null;
	areaIds: readonly string[];
}>;

/** The names of the built-in protected fields. */
const BUILTIN_FIELD_NAMES: Readonly<Record<BuiltinProtectedField, MessageKey>> = {
	address: 'contactSettings.address',
	birthDate: 'import.field.birthDate',
	entryDate: 'import.field.entryDate',
	exitDate: 'import.field.exitDate',
};

/**
 * Tells whether a field key names a built-in field.
 *
 * @param key The key.
 * @returns True for a built-in protected field, false for a custom field.
 */
function isBuiltinField(key: FieldKey): key is BuiltinProtectedField {
	return BUILTIN_PROTECTED_FIELD_KEYS.some((builtin) => builtin === key);
}

/**
 * The areas of a field after one area was ticked or unticked.
 *
 * @param current The areas the field has now.
 * @param areaId The area of the checkbox.
 * @param selected Whether the checkbox is ticked now.
 * @returns The new areas, or null when no area would remain: a protected field keeps one.
 */
function toggledAreaIds(
	current: readonly string[],
	areaId: string,
	selected: boolean,
): readonly string[] | null {
	if (selected) return current.includes(areaId) ? current : [...current, areaId];
	const next = current.filter((id) => id !== areaId);
	return next.length === 0 ? null : next;
}

/**
 * The names of some areas, in the order of the area list (by name, as the page shows them).
 *
 * @param areaIds The areas.
 * @param areas All areas, in the page's order.
 * @returns The names; areas the list does not know are left out.
 */
function areaNames(areaIds: readonly string[], areas: readonly SettingsArea[]): string[] {
	return areas.filter((area) => areaIds.includes(area.id)).map((area) => area.name);
}

/**
 * The name of a protected field: the built-in field's, else the custom field's own name.
 *
 * @param field The field.
 * @param t The translation of the page.
 * @returns The name; the key for a custom field without a name, which the server never sends.
 */
function protectedFieldName(
	field: Pick<ProtectedFieldRow, 'customName' | 'key'>,
	t: (key: MessageKey) => string,
): string {
	if (isBuiltinField(field.key)) return t(BUILTIN_FIELD_NAMES[field.key]);
	return field.customName ?? field.key;
}

/**
 * The rows of the table of one kind, from its field protection (`getFieldAreas`).
 *
 * @param fieldAreas The areas of each protected field, in the order of the table.
 * @param customFields The custom fields, for the names of protected custom fields.
 * @returns One row per field.
 */
function protectedFieldRows(
	fieldAreas: ReadonlyMap<FieldKey, readonly string[]>,
	customFields: readonly Readonly<{ id: string; name: string }>[],
): ProtectedFieldRow[] {
	const names = new Map(customFields.map((field) => [customFieldKey(field.id), field.name]));
	return [...fieldAreas].map(([key, areaIds]) => ({
		areaIds: [...areaIds],
		customName: names.get(key) ?? null,
		key,
	}));
}

export { areaNames, protectedFieldName, protectedFieldRows, toggledAreaIds };
export type { ProtectedFieldRow, SettingsArea };
