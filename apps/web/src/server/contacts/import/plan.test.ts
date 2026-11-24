import { describe, expect, it } from 'vite-plus/test';

import type { ContactRecord } from '@/server/db/schema';

import { changedFields } from './plan';
import type { ImportedRow } from './rows';

const SPIND_ID = '0b9a4c39-3f6e-4d0b-9a64-0c4c3b0f7a11';
const SINCE_ID = '3c2b6a51-1d4e-4b8f-9f0a-6e7d8c9b0a12';

/** A stored member; all data is invented. */
const MEMBER: ContactRecord = {
	birthDate: '1980-05-17',
	city: null,
	contactKey: 'nr:1',
	createdAt: new Date('2026-01-01T00:00:00Z'),
	customValues: { [SPIND_ID]: 'A-12' },
	customerNumber: null,
	email: 'anna.1@example.org',
	entryDate: null,
	exitDate: null,
	firstName: 'Anna',
	gender: 'female',
	groups: ['Fußball'],
	id: '7e0f3a9c-2b1d-4c5e-8f6a-1b2c3d4e5f60',
	kind: 'member',
	lastName: 'Beispiel',
	memberNumber: '1',
	organization: null,
	postalCode: null,
	street: null,
	tags: [],
	updatedAt: new Date('2026-01-01T00:00:00Z'),
};

/** The row that imports `MEMBER` unchanged. */
const SAME_ROW: ImportedRow = {
	blank: [],
	custom: { [SPIND_ID]: 'A-12' },
	groups: ['Fußball'],
	line: 2,
	values: {
		birthDate: '1980-05-17',
		email: 'anna.1@example.org',
		firstName: 'Anna',
		gender: 'female',
		lastName: 'Beispiel',
		memberNumber: '1',
	},
};

/** A stored partner without customer number; all data is invented. */
const PARTNER: ContactRecord = {
	...MEMBER,
	birthDate: null,
	contactKey: 'email:info@example.org',
	customValues: {},
	email: 'info@example.org',
	firstName: null,
	gender: 'unspecified',
	groups: [],
	kind: 'partner',
	lastName: null,
	memberNumber: null,
	organization: 'Bäckerei Körner GmbH',
	tags: ['Sponsor'],
};

describe(changedFields, () => {
	it('finds no change when a row repeats the stored values', () => {
		expect(changedFields(MEMBER, SAME_ROW, 'replace')).toStrictEqual([]);
		expect(changedFields(MEMBER, SAME_ROW, 'merge')).toStrictEqual([]);
	});

	it('replace: clears what the row does not carry', () => {
		const row: ImportedRow = {
			...SAME_ROW,
			custom: {},
			groups: null,
			values: { lastName: 'Beispiel', memberNumber: '1' },
		};
		expect(changedFields(MEMBER, row, 'replace')).toStrictEqual([
			'firstName',
			'email',
			'gender',
			'birthDate',
			'groups',
			`custom:${SPIND_ID}`,
		]);
	});

	it('replace: lists fields in field order, then groups, then custom fields', () => {
		const row: ImportedRow = {
			...SAME_ROW,
			custom: { [SINCE_ID]: '2020-01-01', [SPIND_ID]: 'B-7', 'new:Spitzname': 'Anni' },
			groups: ['Fußball', 'Aktiv'],
			values: { ...SAME_ROW.values, exitDate: '2027-06-30', street: 'Hauptstraße 1' },
		};
		expect(changedFields(MEMBER, row, 'replace')).toStrictEqual([
			'exitDate',
			'street',
			'groups',
			`custom:${SINCE_ID}`,
			`custom:${SPIND_ID}`,
			'custom:new:Spitzname',
		]);
	});

	it('narrows an unknown gender to unspecified', () => {
		const row: ImportedRow = { ...SAME_ROW, values: { ...SAME_ROW.values, gender: 'other' } };
		expect(changedFields(MEMBER, row, 'replace')).toStrictEqual(['gender']);
		const unspecified: ContactRecord = { ...MEMBER, gender: 'unspecified' };
		expect(changedFields(unspecified, row, 'replace')).toStrictEqual([]);
	});

	it('merge: changes only fields with a value, null clears', () => {
		const row: ImportedRow = {
			blank: ['firstName', 'email'],
			custom: { 'new:Spitzname': 'Bäcker' },
			groups: null,
			line: 2,
			values: {
				customerNumber: '100001',
				lastName: null,
				organization: 'Bäckerei Körner GmbH',
			},
		};
		const stored: ContactRecord = { ...PARTNER, lastName: 'Körner' };
		expect(changedFields(stored, row, 'merge')).toStrictEqual([
			'customerNumber',
			'lastName',
			'custom:new:Spitzname',
		]);
	});

	it('merge: keeps stored custom values the row does not carry', () => {
		const row: ImportedRow = {
			...SAME_ROW,
			custom: {},
			groups: null,
			values: { memberNumber: '1' },
		};
		expect(changedFields(MEMBER, row, 'merge')).toStrictEqual([]);
	});
});
