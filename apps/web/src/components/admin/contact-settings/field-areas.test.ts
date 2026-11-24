import { describe, expect, it } from 'vite-plus/test';

import { translate } from '@/i18n/translate';
import type { MessageKey } from '@/i18n/translate';

import { areaNames, protectedFieldName, protectedFieldRows, toggledAreaIds } from './field-areas';

const MEMBERS = 'a0000000-0000-4000-8000-000000000001';
const FINANCE = 'a0000000-0000-4000-8000-000000000002';
const YOUTH = 'a0000000-0000-4000-8000-000000000003';

/** The areas as the page lists them: sorted by name, ignoring case. */
const AREAS = [
	{ id: FINANCE, name: 'Finanzen' },
	{ id: YOUTH, name: 'jugend' },
	{ id: MEMBERS, name: 'Mitglieder' },
];

/**
 * The German translation, as the page uses it.
 *
 * @param key The key of the text.
 * @returns The text.
 */
function t(key: MessageKey): string {
	return translate('de', key);
}

describe(toggledAreaIds, () => {
	it('adds a ticked area once', () => {
		expect(toggledAreaIds([MEMBERS], FINANCE, true)).toStrictEqual([MEMBERS, FINANCE]);
		expect(toggledAreaIds([MEMBERS], MEMBERS, true)).toStrictEqual([MEMBERS]);
	});

	it('removes an unticked area', () => {
		expect(toggledAreaIds([MEMBERS, FINANCE], MEMBERS, false)).toStrictEqual([FINANCE]);
		expect(toggledAreaIds([MEMBERS, FINANCE], YOUTH, false)).toStrictEqual([MEMBERS, FINANCE]);
	});

	it('refuses to remove the last area', () => {
		expect(toggledAreaIds([MEMBERS], MEMBERS, false)).toBeNull();
	});

	it('takes a first area of a field that has none', () => {
		expect(toggledAreaIds([], YOUTH, true)).toStrictEqual([YOUTH]);
	});
});

describe(areaNames, () => {
	it('names the areas in the order of the list', () => {
		expect(areaNames([MEMBERS, FINANCE, YOUTH], AREAS)).toStrictEqual([
			'Finanzen',
			'jugend',
			'Mitglieder',
		]);
	});

	it('skips an area the list does not know', () => {
		expect(areaNames(['a0000000-0000-4000-8000-000000000009', MEMBERS], AREAS)).toStrictEqual([
			'Mitglieder',
		]);
	});
});

describe(protectedFieldName, () => {
	it.each([
		['birthDate', 'Geburtsdatum'],
		['entryDate', 'Eintrittsdatum'],
		['exitDate', 'Austrittsdatum'],
		['address', 'Adresse'],
	] as const)('names the built-in field %s', (key, expected) => {
		expect(protectedFieldName({ customName: null, key }, t)).toBe(expected);
	});

	it('names a custom field by its name, else by its key', () => {
		const key = 'custom:c0000000-0000-4000-8000-000000000001';
		expect(protectedFieldName({ customName: 'Verein', key }, t)).toBe('Verein');
		expect(protectedFieldName({ customName: null, key }, t)).toBe(key);
	});
});

describe(protectedFieldRows, () => {
	it('lists the fields in the order of the protection, custom fields with their name', () => {
		const customId = 'c0000000-0000-4000-8000-000000000001';
		const fieldAreas = new Map([
			['birthDate', [MEMBERS]],
			['address', [FINANCE, MEMBERS]],
			[`custom:${customId}`, [YOUTH]],
		] as const);
		expect(protectedFieldRows(fieldAreas, [{ id: customId, name: 'Verein' }])).toStrictEqual([
			{ areaIds: [MEMBERS], customName: null, key: 'birthDate' },
			{ areaIds: [FINANCE, MEMBERS], customName: null, key: 'address' },
			{ areaIds: [YOUTH], customName: 'Verein', key: `custom:${customId}` },
		]);
	});

	it('gives a field without areas an empty list', () => {
		expect(protectedFieldRows(new Map([['exitDate', []]]), [])).toStrictEqual([
			{ areaIds: [], customName: null, key: 'exitDate' },
		]);
	});
});
