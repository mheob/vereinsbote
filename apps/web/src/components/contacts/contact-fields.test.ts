import { describe, expect, it } from 'vite-plus/test';

import type { ContactDetail } from '@/server/contacts/contacts';

import { contactFieldRows } from './contact-fields';

const LOCKER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CONTRACT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const member: ContactDetail = {
	areas: [],
	canManage: false,
	customValues: [{ id: LOCKER_ID, name: 'Spind', type: 'text', value: '17' }],
	customerNumber: null,
	email: 'anna.abel@example.org',
	firstName: 'Anna',
	gender: 'female',
	groups: ['Fußball', 'Tischtennis'],
	id: '5b2d8f2e-3c4a-4c1e-9a77-0d2a1f3e4b5c',
	kind: 'member',
	lastName: 'Abel',
	memberNumber: '1001',
	name: { primary: 'Anna Abel', secondary: null },
	optOuts: [],
	organization: null,
	protectedValues: { birthDate: '1950-01-12', city: 'Musterstadt', exitDate: '2026-12-31' },
	suppression: null,
	tags: [],
};

const partner: ContactDetail = {
	...member,
	customValues: [{ id: CONTRACT_ID, name: 'Vertrag bis', type: 'date', value: '2027-03-01' }],
	customerNumber: '100099',
	email: null,
	firstName: null,
	gender: 'unspecified',
	groups: [],
	kind: 'partner',
	lastName: null,
	memberNumber: null,
	name: { primary: 'Sportpresse Nord', secondary: null },
	organization: 'Sportpresse Nord',
	protectedValues: {},
	tags: ['Presse', 'Sponsor'],
};

describe(contactFieldRows, () => {
	it('lists the base fields, then the protected and custom values the member has', () => {
		expect(contactFieldRows(member, 'de')).toStrictEqual([
			{ id: 'memberNumber', label: 'Mitgliedsnummer', value: '1001' },
			{ id: 'organization', label: 'Firma', value: null },
			{ id: 'firstName', label: 'Vorname', value: 'Anna' },
			{ id: 'lastName', label: 'Nachname', value: 'Abel' },
			{ id: 'email', label: 'E-Mail', value: 'anna.abel@example.org' },
			{ id: 'gender', label: 'Geschlecht', value: 'weiblich' },
			{ id: 'groups', label: 'Gruppen', value: 'Fußball, Tischtennis' },
			{ id: 'birthDate', label: 'Geburtsdatum', value: '12.01.1950' },
			{ id: 'exitDate', label: 'Austrittsdatum', value: '31.12.2026' },
			{ id: 'city', label: 'Ort', value: 'Musterstadt' },
			{ id: `custom:${LOCKER_ID}`, label: 'Spind', value: '17' },
		]);
	});

	it('lists the customer number and the tags of a partner and formats custom dates', () => {
		expect(contactFieldRows(partner, 'en')).toStrictEqual([
			{ id: 'customerNumber', label: 'Customer number', value: '100099' },
			{ id: 'organization', label: 'Organization', value: 'Sportpresse Nord' },
			{ id: 'firstName', label: 'First name', value: null },
			{ id: 'lastName', label: 'Last name', value: null },
			{ id: 'email', label: 'Email', value: null },
			{ id: 'gender', label: 'Gender', value: 'not specified' },
			{ id: 'tags', label: 'Tags', value: 'Presse, Sponsor' },
			{ id: `custom:${CONTRACT_ID}`, label: 'Vertrag bis', value: 'Mar 1, 2027' },
		]);
	});

	it('has no value for a member without groups', () => {
		const rows = contactFieldRows({ ...member, groups: [] }, 'de');
		expect(rows.find((row) => row.id === 'groups')).toStrictEqual({
			id: 'groups',
			label: 'Gruppen',
			value: null,
		});
	});
});
