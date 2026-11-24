import { describe, expect, it } from 'vite-plus/test';

import {
	checkPartnerInput,
	invalidPartnerFields,
	MAX_TAG_LENGTH,
	MAX_TAGS,
	normalizeTags,
} from './partner-form';
import type { PartnerInput } from './partner-form';

const emptyPartner: PartnerInput = {
	customerNumber: '',
	email: '',
	firstName: '',
	gender: 'unspecified',
	lastName: '',
	organization: '',
	tags: [],
};

const stadtwerke: PartnerInput = {
	...emptyPartner,
	email: 'presse@stadtwerke.example',
	organization: 'Stadtwerke',
};

const TEXT_FIELD = { id: 'f-text', type: 'text' } as const;
const DATE_FIELD = { id: 'f-date', type: 'date' } as const;

/**
 * Distinct tags `Tag 1`, `Tag 2`, …
 *
 * @param count How many.
 * @returns The tags.
 */
function tags(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `Tag ${index + 1}`);
}

describe(invalidPartnerFields, () => {
	it('requires a name and a customer number or email', () => {
		expect(invalidPartnerFields(emptyPartner)).toStrictEqual({
			email: 'required',
			name: 'required',
		});
	});

	it('accepts an organization with an email only', () => {
		expect(
			invalidPartnerFields({
				...emptyPartner,
				email: 'presse@stadtwerke.example',
				organization: 'Stadtwerke',
			}),
		).toStrictEqual({});
	});

	it('accepts a person with a customer number only', () => {
		expect(
			invalidPartnerFields({ ...emptyPartner, customerNumber: '100009', lastName: 'Beispiel' }),
		).toStrictEqual({});
		expect(
			invalidPartnerFields({ ...emptyPartner, customerNumber: '100009', firstName: 'Anna' }),
		).toStrictEqual({});
	});

	it('counts spaces and control characters as empty', () => {
		expect(
			invalidPartnerFields({
				...emptyPartner,
				customerNumber: ' \t ',
				email: '  ',
				firstName: '\u0007',
				lastName: ' ',
				organization: '\n',
			}),
		).toStrictEqual({ email: 'required', name: 'required' });
	});

	it('flags an invalid address, birth date and too many tags', () => {
		expect(
			invalidPartnerFields({
				...stadtwerke,
				birthDate: '31.02.1980',
				email: 'presse@',
				tags: tags(MAX_TAGS + 1),
			}),
		).toStrictEqual({ birthDate: 'invalid', email: 'invalid', tags: 'invalid' });
		expect(invalidPartnerFields({ ...stadtwerke, birthDate: '17.05.80' })).toStrictEqual({
			birthDate: 'invalid',
		});
		expect(
			invalidPartnerFields({ ...stadtwerke, tags: ['Sponsor', 'x'.repeat(MAX_TAG_LENGTH + 1)] }),
		).toStrictEqual({ tags: 'invalid' });
	});

	it('accepts the limits of tags and counts a tag once regardless of case', () => {
		expect([MAX_TAGS, MAX_TAG_LENGTH]).toStrictEqual([20, 40]);
		const atLimit = [...tags(MAX_TAGS - 1), 'x'.repeat(MAX_TAG_LENGTH)];
		expect(invalidPartnerFields({ ...stadtwerke, tags: atLimit })).toStrictEqual({});
		const repeated = [...tags(MAX_TAGS), 'TAG 1', ' tag 2 ', ''];
		expect(invalidPartnerFields({ ...stadtwerke, tags: repeated })).toStrictEqual({});
	});

	it('limits the lengths of decision 10', () => {
		const longest: PartnerInput = {
			...emptyPartner,
			city: 'c'.repeat(200),
			customerNumber: '1'.repeat(50),
			email: `${'a'.repeat(64)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(59)}.example`,
			firstName: 'f'.repeat(200),
			lastName: 'l'.repeat(200),
			organization: 'o'.repeat(200),
			postalCode: '1'.repeat(20),
			street: 's'.repeat(200),
		};
		expect(longest.email).toHaveLength(254);
		expect(invalidPartnerFields(longest)).toStrictEqual({});
		expect(
			invalidPartnerFields({
				...longest,
				city: `${longest.city}c`,
				customerNumber: `${longest.customerNumber}1`,
				email: `a${longest.email}`,
				firstName: `${longest.firstName}f`,
				lastName: `${longest.lastName}l`,
				organization: `${longest.organization}o`,
				postalCode: `${longest.postalCode}1`,
				street: `${longest.street}s`,
			}),
		).toStrictEqual({
			city: 'invalid',
			customerNumber: 'invalid',
			email: 'invalid',
			firstName: 'invalid',
			lastName: 'invalid',
			organization: 'invalid',
			postalCode: 'invalid',
			street: 'invalid',
		});
	});

	it('checks custom values by the type of their field', () => {
		const fields = [TEXT_FIELD, DATE_FIELD];
		expect(
			invalidPartnerFields(
				{ ...stadtwerke, custom: { 'f-date': '30.02.2020', 'f-text': 'x'.repeat(501) } },
				fields,
			),
		).toStrictEqual({ 'custom:f-date': 'invalid', 'custom:f-text': 'invalid' });
		expect(
			invalidPartnerFields(
				{ ...stadtwerke, custom: { 'f-date': '29.02.2020', 'f-text': 'x'.repeat(500) } },
				fields,
			),
		).toStrictEqual({});
		expect(
			invalidPartnerFields({ ...stadtwerke, custom: { 'f-date': '', 'f-text': '' } }, fields),
		).toStrictEqual({});
		// A field the form does not know cannot take a value.
		expect(invalidPartnerFields({ ...stadtwerke, custom: { other: 'x' } }, fields)).toStrictEqual({
			'custom:other': 'invalid',
		});
	});
});

describe(checkPartnerInput, () => {
	it('cleans the values as they are stored', () => {
		expect(
			checkPartnerInput(
				{
					birthDate: '17.05.1980',
					city: ' Musterstadt ',
					custom: { 'f-date': '1.2.2021', 'f-text': ' ' },
					customerNumber: ' 100009 ',
					email: ' Presse@Stadtwerke.Example ',
					firstName: '',
					gender: 'female',
					lastName: ' Beispiel ',
					organization: ' Stadtwerke\tNord ',
					postalCode: '',
					street: 'Hauptstr.\u0000 1',
					tags: [' Presse ', 'presse', ''],
				},
				[TEXT_FIELD, DATE_FIELD],
			),
		).toStrictEqual({
			ok: true,
			values: {
				birthDate: '1980-05-17',
				city: 'Musterstadt',
				custom: { 'f-date': '2021-02-01', 'f-text': null },
				customerNumber: '100009',
				email: 'presse@stadtwerke.example',
				firstName: null,
				gender: 'female',
				lastName: 'Beispiel',
				organization: 'Stadtwerke Nord',
				postalCode: null,
				street: 'Hauptstr. 1',
				tags: ['Presse'],
			},
		});
	});

	it('leaves out the optional fields the form does not carry', () => {
		expect(checkPartnerInput(stadtwerke)).toStrictEqual({
			ok: true,
			values: {
				custom: {},
				customerNumber: null,
				email: 'presse@stadtwerke.example',
				firstName: null,
				gender: 'unspecified',
				lastName: null,
				organization: 'Stadtwerke',
				tags: [],
			},
		});
	});

	it('gives the errors instead of values', () => {
		expect(checkPartnerInput({ ...stadtwerke, street: 's'.repeat(201) })).toStrictEqual({
			errors: { street: 'invalid' },
			ok: false,
		});
	});
});

describe(normalizeTags, () => {
	it('merges tags ignoring case and keeps existing spellings', () => {
		expect(normalizeTags([' sponsor', 'Presse', 'SPONSOR', ''], ['Sponsor'])).toStrictEqual([
			'Sponsor',
			'Presse',
		]);
	});

	it('keeps the first spelling of a new tag and the first of the existing ones', () => {
		expect(normalizeTags(['Verein', 'VEREIN', ' Jugend\u0007 '], [])).toStrictEqual([
			'Verein',
			'Jugend',
		]);
		expect(normalizeTags(['presse'], ['Presse', 'PRESSE'])).toStrictEqual(['Presse']);
	});
});
