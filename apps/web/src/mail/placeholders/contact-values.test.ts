import { describe, expect, it } from 'vite-plus/test';

import type { FieldKey } from '@/server/contacts/fields';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import { contactPlaceholderValues } from './contact-values';
import type { ContactValueSource } from './contact-values';
import { DEFAULT_SALUTATIONS } from './salutation';

const member: ContactValueSource = {
	birthDate: '1980-05-17',
	city: 'Musterstadt',
	customValues: {},
	customerNumber: null,
	email: 'anna@example.org',
	entryDate: '2001-01-02',
	exitDate: null,
	firstName: 'Anna',
	gender: 'female',
	groups: ['Fußball', 'Tennis'],
	kind: 'member',
	lastName: 'Beispiel',
	memberNumber: '42',
	organization: null,
	postalCode: '12345',
	street: 'Hauptstraße 1',
	tags: [],
};

const sie = DEFAULT_SALUTATIONS.sie;
const all: ReadonlySet<FieldKey> = new Set<FieldKey>([
	'address',
	'birthDate',
	'entryDate',
	'exitDate',
]);

const field = (
	id: string,
	placeholderKey: string,
	overrides: Partial<CustomFieldRecord> = {},
): CustomFieldRecord => ({
	id,
	kind: 'member',
	name: placeholderKey,
	placeholderKey,
	protection: 'base',
	type: 'text',
	...overrides,
});

describe(contactPlaceholderValues, () => {
	it('delivers protected fields only when the area may see them', () => {
		const values = contactPlaceholderValues(member, new Set<FieldKey>(['entryDate']), [], sie);
		expect(Object.fromEntries(values)).toStrictEqual({
			'contact.displayName': 'Anna Beispiel',
			'contact.email': 'anna@example.org',
			'contact.entryDate': '02.01.2001',
			'contact.firstName': 'Anna',
			'contact.groups': 'Fußball, Tennis',
			'contact.lastName': 'Beispiel',
			'contact.memberNumber': '42',
			salutation: 'Sehr geehrte Frau Beispiel',
		});
	});

	it('formats dates, joins groups and names custom fields by key', () => {
		const fields = [
			field('f1', 'mitgliedSeitAlt', { type: 'date' }),
			field('f2', 'notiz', { protection: 'protected' }),
			field('f3', 'geheim', { protection: 'protected' }),
			field('f4', 'fremd', { kind: 'partner' }),
		];
		const values = contactPlaceholderValues(
			{ ...member, customValues: { f1: '1999-12-31', f2: 'Hallo', f3: 'x', f4: 'y' } },
			new Set<FieldKey>([...all, 'custom:f2']),
			fields,
			sie,
		);
		expect(Object.fromEntries(values)).toMatchObject({
			'contact.birthDate': '17.05.1980',
			'contact.city': 'Musterstadt',
			'contact.custom.mitgliedSeitAlt': '31.12.1999',
			'contact.custom.notiz': 'Hallo',
			'contact.groups': 'Fußball, Tennis',
			'contact.postalCode': '12345',
			'contact.street': 'Hauptstraße 1',
		});
		expect([...values.keys()].filter((key) => key.startsWith('contact.custom.'))).toStrictEqual([
			'contact.custom.mitgliedSeitAlt',
			'contact.custom.notiz',
		]);
	});

	it('leaves out empty values but always sets the salutation', () => {
		const values = contactPlaceholderValues(
			{ ...member, city: null, customerNumber: '', firstName: '  ', groups: [], lastName: null },
			all,
			[],
			sie,
		);
		expect([...values.keys()]).not.toContain('contact.firstName');
		expect(values.get('salutation')).toBe('Guten Tag');
		expect(
			[...values.keys()].filter((key) => /Name|city|groups|customerNumber/u.test(key)),
		).toStrictEqual([]);
	});

	it('keeps values that look like placeholders literally', () => {
		const values = contactPlaceholderValues(
			{ ...member, firstName: '{{contact.email}}' },
			all,
			[],
			DEFAULT_SALUTATIONS.du,
		);
		expect([values.get('contact.firstName'), values.get('salutation')]).toStrictEqual([
			'{{contact.email}}',
			'Liebe {{contact.email}}',
		]);
	});

	it('does not format a stored value that is no date', () => {
		const values = contactPlaceholderValues(
			{ ...member, customValues: { f1: 'kaputt' } },
			all,
			[field('f1', 'd', { type: 'date' })],
			sie,
		);
		expect(values.get('contact.custom.d')).toBe('kaputt');
	});
});
