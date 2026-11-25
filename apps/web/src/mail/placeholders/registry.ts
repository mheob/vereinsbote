/*
 * The placeholders a template can use besides the custom fields of a contact. The editor offers
 * them, the server checks every saved text against them.
 */
import type { MessageKey } from '@/i18n/translate';
import type { FieldKey } from '@/server/contacts/fields';

type PlaceholderGroup = 'contact' | 'brand' | 'salutation' | 'layout';

interface PlaceholderDefinition {
	key: string;
	group: PlaceholderGroup;
	labelKey: MessageKey;
	/** The protected field the value belongs to; null for a field everybody sees. */
	field: FieldKey | null;
	/** Whether the value is a base field (always delivered). */
	base: boolean;
	/** `attribute`: usable in attributes and `<style>` too; contact data is never. */
	context: 'text' | 'attribute';
}

/** The part of a label key behind `mail.placeholder.`. */
type LabelSuffix<Key> = Key extends `mail.placeholder.${infer Suffix}` ? Suffix : never;

const CONTENT_KEY = 'content';
const SALUTATION_KEY = 'salutation';

/**
 * Defines a placeholder whose label key is `mail.placeholder.<key>`.
 *
 * @param key The placeholder key.
 * @param group The group.
 * @param options The protected field and the context.
 * @returns The definition.
 */
function define(
	key: LabelSuffix<MessageKey>,
	group: PlaceholderGroup,
	options: Readonly<{ field?: FieldKey; context?: 'text' | 'attribute' }> = {},
): PlaceholderDefinition {
	return {
		base: options.field === undefined,
		context: options.context ?? 'text',
		field: options.field ?? null,
		group,
		key,
		labelKey: `mail.placeholder.${key}` as MessageKey,
	};
}

const BUILTIN_PLACEHOLDERS: readonly PlaceholderDefinition[] = [
	define('contact.firstName', 'contact'),
	define('contact.lastName', 'contact'),
	define('contact.organization', 'contact'),
	define('contact.displayName', 'contact'),
	define('contact.email', 'contact'),
	define('contact.memberNumber', 'contact'),
	define('contact.customerNumber', 'contact'),
	define('contact.groups', 'contact'),
	define('contact.tags', 'contact'),
	define('contact.birthDate', 'contact', { field: 'birthDate' }),
	define('contact.entryDate', 'contact', { field: 'entryDate' }),
	define('contact.exitDate', 'contact', { field: 'exitDate' }),
	define('contact.street', 'contact', { field: 'address' }),
	define('contact.postalCode', 'contact', { field: 'address' }),
	define('contact.city', 'contact', { field: 'address' }),
	define('salutation', 'salutation'),
	define('brand.name', 'brand', { context: 'attribute' }),
	define('brand.website', 'brand', { context: 'attribute' }),
	define('brand.imprintUrl', 'brand', { context: 'attribute' }),
	define('brand.privacyUrl', 'brand', { context: 'attribute' }),
	define('brand.address', 'brand', { context: 'attribute' }),
	define('brand.register', 'brand', { context: 'attribute' }),
	define('brand.primaryColor', 'brand', { context: 'attribute' }),
	define('brand.secondaryColor', 'brand', { context: 'attribute' }),
	define('brand.textColor', 'brand', { context: 'attribute' }),
	define('brand.backgroundColor', 'brand', { context: 'attribute' }),
	define('brand.linkColor', 'brand', { context: 'attribute' }),
	define('brand.fontFamily', 'brand', { context: 'attribute' }),
	define('brand.headingFontFamily', 'brand', { context: 'attribute' }),
	define('brand.logoUrl', 'brand', { context: 'attribute' }),
	define('brand.footerLogoUrl', 'brand', { context: 'attribute' }),
	define('content', 'layout'),
];

/**
 * The placeholder key of a custom field.
 *
 * @param placeholderKey The stable key of the field.
 * @returns `contact.custom.<key>`.
 */
function customPlaceholderKey(placeholderKey: string): string {
	return `contact.custom.${placeholderKey}`;
}

export { BUILTIN_PLACEHOLDERS, CONTENT_KEY, customPlaceholderKey, SALUTATION_KEY };
export type { PlaceholderDefinition, PlaceholderGroup };
