import { describe, expect, it } from 'vite-plus/test';

import { de } from '@/i18n/de';
import { en } from '@/i18n/en';

import {
	BUILTIN_PLACEHOLDERS,
	CONTENT_KEY,
	SALUTATION_KEY,
	UNSUBSCRIBE_URL_KEY,
	customPlaceholderKey,
} from './registry';
import { parsePlaceholders } from './syntax';

describe('builtin placeholders', () => {
	it('lists the contact keys of the design', () => {
		const keys = BUILTIN_PLACEHOLDERS.filter(({ group }) => group === 'contact').map(
			({ key }) => key,
		);
		expect(keys).toStrictEqual([
			'contact.firstName',
			'contact.lastName',
			'contact.organization',
			'contact.displayName',
			'contact.email',
			'contact.memberNumber',
			'contact.customerNumber',
			'contact.groups',
			'contact.tags',
			'contact.birthDate',
			'contact.entryDate',
			'contact.exitDate',
			'contact.street',
			'contact.postalCode',
			'contact.city',
		]);
	});

	it('lists exactly the brand keys of the design, usable in attributes', () => {
		const brand = BUILTIN_PLACEHOLDERS.filter(({ group }) => group === 'brand');
		expect(brand.map(({ key }) => key)).toStrictEqual([
			'brand.name',
			'brand.website',
			'brand.imprintUrl',
			'brand.privacyUrl',
			'brand.address',
			'brand.register',
			'brand.primaryColor',
			'brand.secondaryColor',
			'brand.textColor',
			'brand.backgroundColor',
			'brand.linkColor',
			'brand.fontFamily',
			'brand.headingFontFamily',
			'brand.logoUrl',
			'brand.footerLogoUrl',
		]);
		expect(brand.every(({ context }) => context === 'attribute')).toBe(true);
	});

	it('keeps contact data and the salutation out of attributes', () => {
		const attribute = BUILTIN_PLACEHOLDERS.filter(({ context }) => context === 'attribute');
		expect(
			attribute.filter(({ group }) => group !== 'brand').map(({ group, key }) => `${group}:${key}`),
		).toStrictEqual([`layout:${UNSUBSCRIBE_URL_KEY}`]);
	});

	it('protects birth date, entry and exit date and the address', () => {
		const protectedKeys = BUILTIN_PLACEHOLDERS.filter(({ base }) => !base).map(({ field, key }) => [
			key,
			field,
		]);
		expect(protectedKeys).toStrictEqual([
			['contact.birthDate', 'birthDate'],
			['contact.entryDate', 'entryDate'],
			['contact.exitDate', 'exitDate'],
			['contact.street', 'address'],
			['contact.postalCode', 'address'],
			['contact.city', 'address'],
		]);
	});

	it('has the salutation, the layout content and the unsubscribe link', () => {
		expect(BUILTIN_PLACEHOLDERS.find(({ key }) => key === SALUTATION_KEY)?.group).toBe(
			'salutation',
		);
		expect(BUILTIN_PLACEHOLDERS.find(({ key }) => key === CONTENT_KEY)?.group).toBe('layout');
		expect(BUILTIN_PLACEHOLDERS.find(({ key }) => key === UNSUBSCRIBE_URL_KEY)).toMatchObject({
			base: true,
			context: 'attribute',
			group: 'layout',
			key: 'unsubscribe.url',
		});
	});

	it('has valid, unique keys and a label in both languages', () => {
		const keys = BUILTIN_PLACEHOLDERS.map(({ key }) => key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const { key, labelKey } of BUILTIN_PLACEHOLDERS) {
			expect(parsePlaceholders(`{{${key}}}`).ok).toBe(true);
			expect(de[labelKey]).not.toBe('');
			expect(en[labelKey]).not.toBe('');
		}
	});
});

describe(customPlaceholderKey, () => {
	it('prefixes the key of a custom field', () => {
		expect(customPlaceholderKey('mitgliedSeitAlt')).toBe('contact.custom.mitgliedSeitAlt');
	});
});
