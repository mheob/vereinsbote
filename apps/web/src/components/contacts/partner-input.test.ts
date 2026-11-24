import { describe, expect, it } from 'vite-plus/test';

import {
	customFieldName,
	firstInvalidField,
	partnerErrorMessages,
	partnerFieldMessage,
	partnerFieldOrder,
	partlyTypedDates,
	readPartnerInput,
	tagSuggestionsFor,
	withTag,
} from './partner-input';

const CONTRACT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CONTACT_PERSON_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/**
 * A submitted form.
 *
 * @param entries The fields.
 * @returns The form data.
 */
function formData(entries: Readonly<Record<string, string>>): FormData {
	const data = new FormData();
	for (const [name, value] of Object.entries(entries)) data.append(name, value);
	return data;
}

describe(customFieldName, () => {
	it('names the input of a custom field like its error', () => {
		expect(customFieldName(CONTRACT_ID)).toBe(`custom:${CONTRACT_ID}`);
	});
});

describe(readPartnerInput, () => {
	it('reads the base fields, the shown fields and the tags', () => {
		const input = readPartnerInput(
			formData({
				birthDate: '1980-05-17',
				city: 'Musterstadt',
				customerNumber: '100009',
				[`custom:${CONTRACT_ID}`]: '2027-12-31',
				[`custom:${CONTACT_PERSON_ID}`]: 'Frau Beispiel',
				email: 'presse@stadtwerke.example',
				firstName: 'Anna',
				gender: 'female',
				lastName: 'Beispiel',
				organization: 'Stadtwerke',
				// Not shown to the user, so never sent, even when the form carries it.
				street: 'Hauptstr. 1',
			}),
			{
				customFields: [{ id: CONTRACT_ID }, { id: CONTACT_PERSON_ID }],
				protectedFields: ['birthDate', 'city'],
			},
			['Presse'],
		);
		expect(input).toStrictEqual({
			birthDate: '1980-05-17',
			city: 'Musterstadt',
			custom: { [CONTACT_PERSON_ID]: 'Frau Beispiel', [CONTRACT_ID]: '2027-12-31' },
			customerNumber: '100009',
			email: 'presse@stadtwerke.example',
			firstName: 'Anna',
			gender: 'female',
			lastName: 'Beispiel',
			organization: 'Stadtwerke',
			tags: ['Presse'],
		});
	});

	it('reads missing fields as empty and an unknown gender as unspecified', () => {
		const input = readPartnerInput(
			formData({ gender: 'robot' }),
			{ customFields: [{ id: CONTRACT_ID }], protectedFields: ['street'] },
			[],
		);
		expect(input).toStrictEqual({
			custom: { [CONTRACT_ID]: '' },
			customerNumber: '',
			email: '',
			firstName: '',
			gender: 'unspecified',
			lastName: '',
			organization: '',
			street: '',
			tags: [],
		});
	});
});

describe(partnerFieldMessage, () => {
	it.each([
		['name', 'required', 'partner.nameRequired'],
		['email', 'required', 'partner.keyRequired'],
		['email', 'invalid', 'partner.invalid'],
		['customerNumber', 'taken', 'partner.customerNumberTaken'],
		['customerNumber', 'invalid', 'partner.invalid'],
		['tags', 'invalid', 'partner.invalid'],
		[`custom:${CONTRACT_ID}`, 'invalid', 'partner.invalid'],
	] as const)('names %s %s as %s', (field, error, key) => {
		expect(partnerFieldMessage(field, error)).toBe(key);
	});
});

describe(partnerErrorMessages, () => {
	it('shows a missing name once, at the organization, and every other error at its field', () => {
		expect(
			partnerErrorMessages({
				[`custom:${CONTRACT_ID}`]: 'invalid',
				customerNumber: 'taken',
				email: 'required',
				name: 'required',
			}),
		).toStrictEqual({
			[`custom:${CONTRACT_ID}`]: 'partner.invalid',
			customerNumber: 'partner.customerNumberTaken',
			email: 'partner.keyRequired',
			organization: 'partner.nameRequired',
		});
	});

	it('has no messages without errors', () => {
		expect(partnerErrorMessages({})).toStrictEqual({});
	});
});

describe(partnerFieldOrder, () => {
	it('lists the inputs in form order', () => {
		expect(
			partnerFieldOrder({
				customFields: [{ id: CONTRACT_ID }],
				protectedFields: ['birthDate', 'street', 'postalCode', 'city'],
			}),
		).toStrictEqual([
			'customerNumber',
			'organization',
			'firstName',
			'lastName',
			'email',
			'birthDate',
			'street',
			'postalCode',
			'city',
			`custom:${CONTRACT_ID}`,
			'tags',
		]);
	});
});

describe(firstInvalidField, () => {
	const order = partnerFieldOrder({ customFields: [], protectedFields: ['birthDate'] });

	it('finds the first input in form order with an error', () => {
		expect(firstInvalidField({ birthDate: 'invalid', email: 'required' }, order)).toBe('email');
		expect(firstInvalidField({ email: 'required', name: 'required' }, order)).toBe('organization');
		expect(firstInvalidField({ tags: 'invalid' }, order)).toBe('tags');
	});

	it('finds nothing without errors or for an input the form does not have', () => {
		expect(firstInvalidField({}, order)).toBeNull();
		expect(firstInvalidField({ city: 'invalid' }, order)).toBeNull();
	});
});

describe(partlyTypedDates, () => {
	it('refuses a date with some segments typed and others empty', () => {
		expect(
			partlyTypedDates([
				// „17.05.“ without the year.
				{ name: 'birthDate', segmentsFilled: [true, true, false] },
				// A stored date with the month cleared.
				{ name: `custom:${CONTRACT_ID}`, segmentsFilled: [true, false, true] },
			]),
		).toStrictEqual({ birthDate: 'invalid', [`custom:${CONTRACT_ID}`]: 'invalid' });
	});

	it('takes a complete or an empty date', () => {
		expect(
			partlyTypedDates([
				{ name: 'birthDate', segmentsFilled: [true, true, true] },
				{ name: `custom:${CONTRACT_ID}`, segmentsFilled: [false, false, false] },
				{ name: `custom:${CONTACT_PERSON_ID}`, segmentsFilled: [] },
			]),
		).toStrictEqual({});
	});
});

describe(withTag, () => {
	it('adds a cleaned tag in the spelling of an existing one', () => {
		expect(withTag(['Sponsor'], '  presse ', ['Presse'])).toStrictEqual(['Sponsor', 'Presse']);
	});

	it('adds a tag once regardless of case and ignores an empty one', () => {
		expect(withTag(['Sponsor'], 'SPONSOR', [])).toStrictEqual(['Sponsor']);
		expect(withTag(['Sponsor'], '   ', [])).toStrictEqual(['Sponsor']);
	});
});

describe(tagSuggestionsFor, () => {
	const suggestions = ['Jugend', 'Presse', 'Sponsor'];

	it('suggests the tags the partner does not have, ignoring case', () => {
		expect(tagSuggestionsFor(suggestions, ['presse'], '')).toStrictEqual(['Jugend', 'Sponsor']);
	});

	it('suggests the tags that contain the typed text, ignoring case and spaces around it', () => {
		expect(tagSuggestionsFor(suggestions, [], ' SpO ')).toStrictEqual(['Sponsor']);
		expect(tagSuggestionsFor(suggestions, [], 'e')).toStrictEqual(['Jugend', 'Presse']);
	});
});
