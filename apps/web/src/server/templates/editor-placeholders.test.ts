import { describe, expect, it } from 'vite-plus/test';

import type { CustomFieldRecord } from '@/server/contacts/settings';

import { editorPlaceholders, placeholderLabel } from './editor-placeholders';

const BASE_KEYS = [
	'contact.firstName',
	'contact.lastName',
	'contact.organization',
	'contact.displayName',
	'contact.email',
	'contact.memberNumber',
	'contact.customerNumber',
	'contact.groups',
	'contact.tags',
	'salutation',
	'brand.name',
	'brand.website',
	'brand.imprintUrl',
	'brand.privacyUrl',
	'brand.address',
	'brand.register',
	'brand.primaryColor',
	'brand.fontFamily',
	'brand.logoUrl',
];

const field = (
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a test helper over a record with mutable fields
	overrides: Readonly<Partial<CustomFieldRecord>> &
		Pick<CustomFieldRecord, 'name' | 'placeholderKey'>,
): CustomFieldRecord => ({
	id: `field-${overrides.placeholderKey}`,
	kind: 'member',
	protection: 'base',
	type: 'text',
	...overrides,
});

const t = (key: string): string => `«${key}»`;

describe(editorPlaceholders, () => {
	it('offers the contact fields, the salutation and the texts of the brand, in groups', () => {
		const offered = editorPlaceholders(new Set(BASE_KEYS), []);
		expect(offered.map(({ group, key }) => `${group}:${key}`)).toStrictEqual([
			'contact:contact.firstName',
			'contact:contact.lastName',
			'contact:contact.organization',
			'contact:contact.displayName',
			'contact:contact.email',
			'contact:contact.memberNumber',
			'contact:contact.customerNumber',
			'contact:contact.groups',
			'contact:contact.tags',
			'salutation:salutation',
			'brand:brand.name',
			'brand:brand.website',
			'brand:brand.imprintUrl',
			'brand:brand.privacyUrl',
			'brand:brand.address',
			'brand:brand.register',
		]);
		expect(offered[0]).toStrictEqual({
			group: 'contact',
			key: 'contact.firstName',
			labelKey: 'mail.placeholder.contact.firstName',
			name: null,
		});
	});

	it('offers a protected field only when the area may use it', () => {
		const without = editorPlaceholders(new Set(BASE_KEYS), []);
		expect(without.map(({ key }) => key)).not.toContain('contact.birthDate');
		const withBirthDate = editorPlaceholders(new Set([...BASE_KEYS, 'contact.birthDate']), []);
		expect(withBirthDate.map(({ key }) => key)).toContain('contact.birthDate');
	});

	it('offers the allowed custom fields with their names, each key once', () => {
		const fields = [
			field({ name: 'Typ', placeholderKey: 'typ' }),
			field({ kind: 'partner', name: 'Typ (Partner)', placeholderKey: 'typ' }),
			field({ name: 'Trikotgröße', placeholderKey: 'trikotgroesse', protection: 'protected' }),
		];
		const offered = editorPlaceholders(new Set([...BASE_KEYS, 'contact.custom.typ']), fields);
		expect(offered.filter(({ key }) => key.startsWith('contact.custom.'))).toStrictEqual([
			{ group: 'contact', key: 'contact.custom.typ', labelKey: null, name: 'Typ' },
		]);
		// Custom fields follow the built-in contact fields.
		expect(offered.findIndex(({ key }) => key === 'contact.custom.typ')).toBe(9);
	});
});

describe(placeholderLabel, () => {
	const offered = editorPlaceholders(new Set([...BASE_KEYS, 'contact.custom.typ']), [
		field({ name: 'Typ', placeholderKey: 'typ' }),
	]);

	it('names a built-in placeholder by its translation', () => {
		expect(placeholderLabel('contact.birthDate', offered, t)).toBe(
			'«mail.placeholder.contact.birthDate»',
		);
	});

	it('names a custom field by its name, or by its key when it is not offered', () => {
		expect(placeholderLabel('contact.custom.typ', offered, t)).toBe('Typ');
		expect(placeholderLabel('contact.custom.alt', offered, t)).toBe('alt');
	});

	it('shows an unknown key as it is', () => {
		expect(placeholderLabel('occasion.date', offered, t)).toBe('occasion.date');
	});
});
