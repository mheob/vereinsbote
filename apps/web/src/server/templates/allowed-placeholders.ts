/*
 * Which placeholders a template and a layout may use (Design 10.2). A template's set depends only
 * on its area and the field protection, never on a user: sending runs without one.
 */
import {
	BUILTIN_PLACEHOLDERS,
	CONTENT_KEY,
	customPlaceholderKey,
} from '@/mail/placeholders/registry';
import { customFieldKey } from '@/server/contacts/fields';
import type { ContactKind, FieldKey } from '@/server/contacts/fields';
import { areaFieldKeys, listCustomFields } from '@/server/contacts/settings';
import type { CustomFieldRecord } from '@/server/contacts/settings';
import type { Db } from '@/server/db/client';

/** The placeholders of the templates of one area. */
interface AllowedPlaceholders {
	/** The keys a template of the area may use. */
	readonly keys: ReadonlySet<string>;
	/**
	 * Every key that exists, allowed here or not: a key outside it is unknown, a key in it but not
	 * in `keys` is forbidden here.
	 */
	readonly known: ReadonlySet<string>;
	/** The protected fields the rendering delivers, per kind of contact. */
	readonly deliveredByKind: Readonly<Record<ContactKind, ReadonlySet<FieldKey>>>;
}

/** The built-in keys of a template: all but the layout's `content`. */
const TEMPLATE_BUILTINS = BUILTIN_PLACEHOLDERS.filter(({ group }) => group !== 'layout');

/** Global layouts: brand values, the base fields of contacts and `content` (Design 10.2). */
const GLOBAL_LAYOUT_KEYS: ReadonlySet<string> = new Set(
	BUILTIN_PLACEHOLDERS.filter(
		({ base, group }) => group === 'brand' || group === 'layout' || (group === 'contact' && base),
	).map(({ key }) => key),
);

/**
 * The placeholders of an area from the protected fields it sees. Base fields, brand values and
 * the salutation are always allowed; a protected field when the area sees it for at least one
 * kind; a custom field when it is a base field or the area sees it for its kind.
 *
 * @param deliveredByKind The protected fields the area sees, per kind (`areaFieldKeys`).
 * @param customFields The custom fields of both kinds.
 * @returns The allowed and the known keys.
 */
function templatePlaceholders(
	deliveredByKind: Readonly<Record<ContactKind, ReadonlySet<FieldKey>>>,
	customFields: readonly Readonly<CustomFieldRecord>[],
): AllowedPlaceholders {
	const delivered = new Set([...deliveredByKind.member, ...deliveredByKind.partner]);
	const builtins = TEMPLATE_BUILTINS.filter(
		({ field }) => field === null || delivered.has(field),
	).map(({ key }) => key);
	const custom = customFields
		.filter(
			(field) =>
				field.protection === 'base' || deliveredByKind[field.kind].has(customFieldKey(field.id)),
		)
		.map((field) => customPlaceholderKey(field.placeholderKey));
	const known = [
		...BUILTIN_PLACEHOLDERS.map(({ key }) => key),
		...customFields.map((field) => customPlaceholderKey(field.placeholderKey)),
	];
	return { deliveredByKind, keys: new Set([...builtins, ...custom]), known: new Set(known) };
}

/**
 * The placeholders a template of an area may use. Runs several queries at once: call it before a
 * transaction, never inside one.
 *
 * @param db The database.
 * @param areaId The area of the template.
 * @returns The allowed keys, the known keys and the protected fields per kind.
 */
async function allowedTemplatePlaceholders(db: Db, areaId: string): Promise<AllowedPlaceholders> {
	const [deliveredByKind, members, partners] = await Promise.all([
		areaFieldKeys(db, areaId),
		listCustomFields(db, 'member'),
		listCustomFields(db, 'partner'),
	]);
	return templatePlaceholders(deliveredByKind, [...members, ...partners]);
}

/** The placeholders of a layout: the allowed keys, and every key that exists. */
interface LayoutPlaceholders {
	readonly keys: ReadonlySet<string>;
	readonly known: ReadonlySet<string>;
}

/** Every built-in key; the base of the `known` set of a layout. */
const BUILTIN_KEYS = BUILTIN_PLACEHOLDERS.map(({ key }) => key);

/**
 * The placeholders of a global layout: brand values, the base fields of contacts (the built-in
 * ones and the custom fields with protection `base`) and `content`.
 *
 * @param scope `global`.
 * @param customFields The custom fields of both kinds.
 * @returns The allowed and the known keys.
 */
function allowedLayoutPlaceholders(
	scope: 'global',
	customFields: readonly Readonly<CustomFieldRecord>[],
): LayoutPlaceholders;
/**
 * The placeholders of a template's own layout: what its template may use, and `content`.
 *
 * @param scope `template`.
 * @param template The placeholders of the template.
 * @returns The allowed and the known keys.
 */
function allowedLayoutPlaceholders(
	scope: 'template',
	template: AllowedPlaceholders,
): LayoutPlaceholders;
/**
 * The placeholders a layout may use (Design 10.2). The scope is told by the second argument: a
 * template's placeholders make its own layout, the custom fields make a global one.
 *
 * @param _scope `global` for a shared layout, `template` for a template's own layout.
 * @param source The custom fields (`global`) or the placeholders of the template (`template`).
 * @returns The allowed and the known keys.
 */
function allowedLayoutPlaceholders(
	_scope: 'global' | 'template',
	source: readonly Readonly<CustomFieldRecord>[] | AllowedPlaceholders,
): LayoutPlaceholders {
	if ('known' in source) {
		return { keys: new Set([...source.keys, CONTENT_KEY]), known: source.known };
	}
	return {
		keys: new Set([
			...GLOBAL_LAYOUT_KEYS,
			...source
				.filter((field) => field.protection === 'base')
				.map((field) => customPlaceholderKey(field.placeholderKey)),
		]),
		known: new Set([
			...BUILTIN_KEYS,
			...source.map((field) => customPlaceholderKey(field.placeholderKey)),
		]),
	};
}

export { allowedLayoutPlaceholders, allowedTemplatePlaceholders, templatePlaceholders };
export type { AllowedPlaceholders, LayoutPlaceholders };
