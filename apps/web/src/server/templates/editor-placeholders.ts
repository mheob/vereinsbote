/*
 * The placeholders the editor offers in its menu (Design 13): the allowed ones of the template's
 * area, grouped into contact, salutation and club (brand), with the key of their translated name
 * or, for a custom field, its own name. Brand values that only make sense in attributes (colours,
 * fonts, logo addresses) and the layout's `content` are not offered. No database: the server
 * function passes the allowed keys and the custom fields, and the browser names the placeholders
 * with the same module.
 */
import type { MessageKey } from '@/i18n/translate';
import { BUILTIN_PLACEHOLDERS, customPlaceholderKey } from '@/mail/placeholders/registry';
import type { CustomFieldRecord } from '@/server/contacts/settings';

type EditorPlaceholderGroup = 'contact' | 'salutation' | 'brand';

/** A placeholder of the editor's menu. */
interface EditorPlaceholder {
	readonly key: string;
	readonly group: EditorPlaceholderGroup;
	/** The key of the translated name; null for a custom field. */
	readonly labelKey: MessageKey | null;
	/** The name of a custom field; null for a built-in placeholder. */
	readonly name: string | null;
}

/** The brand values that read as text in a mail. */
const TEXT_BRAND_KEYS: ReadonlySet<string> = new Set([
	'brand.name',
	'brand.website',
	'brand.imprintUrl',
	'brand.privacyUrl',
	'brand.address',
	'brand.register',
]);

const CUSTOM_PREFIX = 'contact.custom.';

const LABEL_KEYS: ReadonlyMap<string, MessageKey> = new Map(
	BUILTIN_PLACEHOLDERS.map(({ key, labelKey }) => [key, labelKey]),
);

/**
 * The built-in placeholders of a group that the area allows.
 *
 * @param group The group.
 * @param allowed The allowed keys.
 * @returns The entries in the order of the registry.
 */
function builtins(
	group: EditorPlaceholderGroup,
	allowed: ReadonlySet<string>,
): EditorPlaceholder[] {
	return BUILTIN_PLACEHOLDERS.filter(
		(entry) =>
			entry.group === group &&
			allowed.has(entry.key) &&
			(group !== 'brand' || TEXT_BRAND_KEYS.has(entry.key)),
	).map(({ key, labelKey }) => ({ group, key, labelKey, name: null }));
}

/**
 * The placeholders the editor offers for an area.
 *
 * @param allowed The keys the area allows (`allowedTemplatePlaceholders(…).keys`).
 * @param customFields The custom fields of both kinds of contacts.
 * @returns The contact fields (built-in, then custom), the salutation and the club's texts.
 */
function editorPlaceholders(
	allowed: ReadonlySet<string>,
	customFields: readonly Readonly<CustomFieldRecord>[],
): EditorPlaceholder[] {
	const custom = new Map<string, EditorPlaceholder>();
	for (const field of customFields) {
		const key = customPlaceholderKey(field.placeholderKey);
		if (allowed.has(key) && !custom.has(key)) {
			custom.set(key, { group: 'contact', key, labelKey: null, name: field.name });
		}
	}
	return [
		...builtins('contact', allowed),
		...custom.values(),
		...builtins('salutation', allowed),
		...builtins('brand', allowed),
	];
}

/**
 * The name of a placeholder as the editor shows it: the translation of a built-in one, the name
 * of an offered custom field, else the key of the field or the key itself.
 *
 * @param key The placeholder key.
 * @param offered The placeholders the editor offers.
 * @param t The translation function.
 * @returns The name.
 */
function placeholderLabel(
	key: string,
	offered: readonly EditorPlaceholder[],
	t: (key: MessageKey) => string,
): string {
	const labelKey = LABEL_KEYS.get(key);
	if (labelKey !== undefined) return t(labelKey);
	const name = offered.find((entry) => entry.key === key)?.name;
	if (name !== undefined && name !== null) return name;
	return key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : key;
}

/**
 * The names of several placeholders in one line, as the preview says what a contact lacks.
 *
 * @param keys The placeholder keys.
 * @param offered The placeholders the editor offers (their custom fields give their own names).
 * @param t The translation function.
 * @returns The names, comma separated.
 */
function placeholderNames(
	keys: readonly string[],
	offered: readonly EditorPlaceholder[],
	t: (key: MessageKey) => string,
): string {
	return keys.map((key) => placeholderLabel(key, offered, t)).join(', ');
}

export { editorPlaceholders, placeholderLabel, placeholderNames };
export type { EditorPlaceholder, EditorPlaceholderGroup };
