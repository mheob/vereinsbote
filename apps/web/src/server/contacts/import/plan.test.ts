import { describe, expect, it } from 'vite-plus/test';

import type { ContactRecord } from '@/server/db/schema';

import { changedFields, diffValues, mergedValues, storedValues } from './plan';
import type { ChangedField, StoredContact } from './plan';
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

/**
 * The fields a row merged into a stored contact changes, as the partner import compares them.
 *
 * @param stored The stored contact.
 * @param row The row.
 * @returns The changed fields.
 */
function mergedChanges(stored: StoredContact, row: ImportedRow): ChangedField[] {
	return diffValues(storedValues(stored), mergedValues(stored, row));
}

describe(changedFields, () => {
	it('finds no change when a row repeats the stored values', () => {
		expect(changedFields(MEMBER, SAME_ROW)).toStrictEqual([]);
	});

	it('clears what the row does not carry', () => {
		const row: ImportedRow = {
			...SAME_ROW,
			custom: {},
			groups: null,
			values: { lastName: 'Beispiel', memberNumber: '1' },
		};
		expect(changedFields(MEMBER, row)).toStrictEqual([
			'firstName',
			'email',
			'gender',
			'birthDate',
			'groups',
			`custom:${SPIND_ID}`,
		]);
	});

	it('lists fields in field order, then groups, then custom fields', () => {
		const row: ImportedRow = {
			...SAME_ROW,
			custom: { [SINCE_ID]: '2020-01-01', [SPIND_ID]: 'B-7', 'new:Spitzname': 'Anni' },
			groups: ['Fußball', 'Aktiv'],
			values: { ...SAME_ROW.values, exitDate: '2027-06-30', street: 'Hauptstraße 1' },
		};
		expect(changedFields(MEMBER, row)).toStrictEqual([
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
		expect(changedFields(MEMBER, row)).toStrictEqual(['gender']);
		const unspecified: ContactRecord = { ...MEMBER, gender: 'unspecified' };
		expect(changedFields(unspecified, row)).toStrictEqual([]);
	});
});

describe(mergedValues, () => {
	it('finds no change when a row repeats the stored values', () => {
		expect(mergedChanges(MEMBER, SAME_ROW)).toStrictEqual([]);
	});

	it('changes only fields with a value, null clears', () => {
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
		const stored: ContactRecord = { ...PARTNER, firstName: 'Lena', lastName: 'Körner' };
		expect(mergedChanges(stored, row)).toStrictEqual([
			'customerNumber',
			'lastName',
			'custom:new:Spitzname',
		]);
		// The blank first name and address keep their stored values.
		expect(mergedValues(stored, row)).toMatchObject({
			customerNumber: '100001',
			email: 'info@example.org',
			firstName: 'Lena',
			lastName: null,
			organization: 'Bäckerei Körner GmbH',
		});
	});

	it('keeps stored custom values and groups the row does not carry', () => {
		const row: ImportedRow = {
			...SAME_ROW,
			custom: {},
			groups: null,
			values: { memberNumber: '1' },
		};
		expect(mergedChanges(MEMBER, row)).toStrictEqual([]);
	});
});
