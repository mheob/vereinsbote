import { describe, expect, it } from 'vite-plus/test';

import type { CustomFieldRecord } from '@/server/contacts/settings';

import type { ImportPayload } from './payload';
import { transformRows } from './rows';
import { memberPayload, partnerPayload } from './testing';

const SINCE_ID = '3c2b6a51-1d4e-4b8f-9f0a-6e7d8c9b0a12';
const SPIND_ID = '0b9a4c39-3f6e-4d0b-9a64-0c4c3b0f7a11';
const GONE_ID = '5d1f8f2e-7c2a-4f55-8a0e-2b7d9c6e4a22';

const CUSTOM_FIELDS: CustomFieldRecord[] = [
	{ id: SINCE_ID, kind: 'member', name: 'Ehrenamt seit', protection: 'protected', type: 'date' },
	{ id: SPIND_ID, kind: 'member', name: 'Spind', protection: 'base', type: 'text' },
];

/**
 * Adds columns at the end of a payload.
 *
 * @param payload The payload.
 * @param columns The new columns.
 * @param cells The cells of the new columns, per row.
 * @returns The wider payload.
 */
function withColumns(
	payload: ImportPayload,
	columns: ImportPayload['columns'],
	cells: readonly (readonly (string | null)[])[],
): ImportPayload {
	return {
		...payload,
		columns: [...payload.columns, ...columns],
		rows: payload.rows.map((row, index) => ({
			...row,
			cells: [...row.cells, ...(cells[index] ?? columns.map(() => null))],
		})),
	};
}

/**
 * Removes a column from a payload.
 *
 * @param payload The payload.
 * @param header The header of the column.
 * @returns The narrower payload.
 */
function withoutColumn(payload: ImportPayload, header: string): ImportPayload {
	const index = payload.columns.findIndex((column) => column.header === header);
	return {
		...payload,
		columns: payload.columns.filter((_column, at) => at !== index),
		rows: payload.rows.map((row) => ({
			...row,
			cells: row.cells.filter((_cell, at) => at !== index),
		})),
	};
}

/**
 * A value of a given length.
 *
 * @param length The number of characters.
 * @returns The value.
 */
function long(length: number): string {
	return 'x'.repeat(length);
}

/**
 * Member rows with the numbers 1 to count.
 *
 * @param count The number of rows.
 * @returns The rows.
 */
function numbers(count: number): string[][] {
	return Array.from({ length: count }, (_row, index) => [`${index + 1}`]);
}

/**
 * Checks two member rows: the first with values over the limits, the second at them.
 *
 * @returns The result.
 */
function transformOverLimits(): ReturnType<typeof transformRows> {
	const payload = memberPayload([
		['1', long(201), long(200), `${long(250)}@example.org`, '', '', `${long(101)}, Fußball`],
		['2', '', '', '', '', '', '', '', ''],
	]);
	const postalCodes: ImportPayload['columns'] = [
		{ header: 'PLZ', target: { field: 'postalCode', type: 'field' } },
	];
	return transformRows(withColumns(payload, postalCodes, [[long(21)], [long(20)]]), []);
}

const PARTNER_ROWS = [
	['100001', 'Bäckerei Körner GmbH', '-', 'info@baeckerei-koerner.example', 'keine Angabe'],
	['100002', 'Müller', 'Lena', 'lena.mueller@example.org', 'weiblich'],
];

describe(transformRows, () => {
	it('maps a row of the member export', () => {
		const { rows, fieldIssues, blocking } = transformRows(
			memberPayload([
				[
					'42',
					'Anna',
					'Abel',
					'anna.abel@example.org',
					'1980-05-17',
					'',
					'Fußball, Danceaerobic',
					'Aktiv',
					'weiblich',
				],
			]),
			[],
		);
		expect(blocking).toStrictEqual([]);
		expect(fieldIssues).toStrictEqual([]);
		expect(rows[0]).toStrictEqual({
			blank: ['exitDate'],
			custom: {},
			groups: ['Fußball', 'Danceaerobic', 'Aktiv'],
			line: 2,
			values: {
				birthDate: '1980-05-17',
				email: 'anna.abel@example.org',
				firstName: 'Anna',
				gender: 'female',
				lastName: 'Abel',
				memberNumber: '42',
			},
		});
	});

	it('treats "-" as empty and keeps leading zeros', () => {
		const { rows, fieldIssues, blocking } = transformRows(
			memberPayload([
				['0042', 'Anna', 'Abel', '-', '17.05.1980', '-', '-', 'Passiv', 'keine Angabe'],
			]),
			[],
		);
		expect(blocking).toStrictEqual([]);
		expect(fieldIssues).toStrictEqual([]);
		expect(rows[0]).toStrictEqual({
			blank: ['email', 'exitDate'],
			custom: {},
			groups: ['Passiv'],
			line: 2,
			values: {
				birthDate: '1980-05-17',
				firstName: 'Anna',
				gender: 'unspecified',
				lastName: 'Abel',
				memberNumber: '0042',
			},
		});
	});

	it('cleans every cell and stores the address normalized', () => {
		const { rows } = transformRows(
			memberPayload([
				[' 42\t', ' Anna\u0007', 'Abel ', ' Anna.Abel@Example.ORG ', '', '', '', '', ''],
			]),
			[],
		);
		expect(rows[0]?.values).toStrictEqual({
			email: 'anna.abel@example.org',
			firstName: 'Anna',
			lastName: 'Abel',
			memberNumber: '42',
		});
	});

	it('warns about invalid email, impossible dates, two-digit years and unknown gender', () => {
		const { rows, fieldIssues, blocking } = transformRows(
			memberPayload([['42', 'Anna', 'Abel', 'anna@', '31.02.1980', '17.05.80', '', '', 'Herr']]),
			[],
		);
		expect(blocking).toStrictEqual([]);
		expect(fieldIssues).toStrictEqual([
			{ column: 'E-Mail', line: 2, reason: 'invalidEmail' },
			{ column: 'Geburtstag', line: 2, reason: 'invalidDate' },
			{ column: 'Mitglied bis', line: 2, reason: 'twoDigitYear' },
			{ column: 'Geschlecht', line: 2, reason: 'unknownGender' },
		]);
		expect(rows[0]).toStrictEqual({
			blank: ['email', 'birthDate', 'exitDate', 'gender'],
			custom: {},
			groups: [],
			line: 2,
			values: { firstName: 'Anna', lastName: 'Abel', memberNumber: '42' },
		});
	});

	it('reads the gender only from the translation of the mapping', () => {
		const { rows, fieldIssues } = transformRows(
			memberPayload(
				[
					['1', '', '', '', '', '', '', '', 'w'],
					['2', '', '', '', '', '', '', '', 'constructor'],
					['3', '', '', '', '', '', '', '', 'Frau'],
				],
				{ genderValues: { Frau: 'female' } },
			),
			[],
		);
		expect(rows.map((row) => row.values.gender)).toStrictEqual([undefined, undefined, 'female']);
		expect(fieldIssues).toStrictEqual([
			{ column: 'Geschlecht', line: 2, reason: 'unknownGender' },
			{ column: 'Geschlecht', line: 3, reason: 'unknownGender' },
		]);
	});

	it('warns about values over the length limits', () => {
		const { rows, fieldIssues, blocking } = transformOverLimits();
		expect(blocking).toStrictEqual([]);
		expect(fieldIssues).toStrictEqual([
			{ column: 'Vorname', line: 2, reason: 'tooLong' },
			{ column: 'E-Mail', line: 2, reason: 'tooLong' },
			{ column: 'Abteilungen', line: 2, reason: 'tooLong' },
			{ column: 'PLZ', line: 2, reason: 'tooLong' },
		]);
		expect(rows[0]?.values).toStrictEqual({ lastName: long(200), memberNumber: '1' });
		expect(rows[0]?.blank).toStrictEqual(
			expect.arrayContaining(['firstName', 'email', 'postalCode']),
		);
	});

	it('keeps the groups within the limit and values at the limit', () => {
		const { rows } = transformOverLimits();
		expect(rows[0]?.groups).toStrictEqual(['Fußball']);
		expect(rows[1]?.values.postalCode).toBe(long(20));
	});

	it('joins the groups of all group columns without case duplicates', () => {
		const { rows } = transformRows(
			memberPayload([['1', '', '', '', '', '', 'Fußball; Aktiv', 'aktiv', '']]),
			[],
		);
		expect(rows[0]?.groups).toStrictEqual(['Fußball', 'Aktiv']);
	});

	it('splits groups at the separators of the options', () => {
		const { rows } = transformRows(
			memberPayload([['1', '', '', '', '', '', 'Fußball, Danceaerobic', '', '']], {
				groupSeparators: [';'],
			}),
			[],
		);
		expect(rows[0]?.groups).toStrictEqual(['Fußball, Danceaerobic']);
	});

	it('uses the empty markers of the options', () => {
		const { rows } = transformRows(
			memberPayload([['1', 'n/a', '-', '', '', '', '', '', '']], { emptyMarkers: ['n/a'] }),
			[],
		);
		expect(rows[0]?.values).toStrictEqual({ lastName: '-', memberNumber: '1' });
		expect(rows[0]?.blank).toContain('firstName');
	});

	it('blocks a missing member number', () => {
		const { blocking } = transformRows(
			memberPayload([
				['1', 'Anna'],
				['-', 'Ben'],
				['', 'Carla'],
			]),
			[],
		);
		expect(blocking).toStrictEqual([
			{ line: 3, reason: 'memberNumberMissing' },
			{ line: 4, reason: 'memberNumberMissing' },
		]);
	});

	it('blocks duplicate member numbers after trimming', () => {
		const { blocking } = transformRows(
			memberPayload([
				['42', 'Anna'],
				[' 42', 'Ben'],
				['43', 'Carla'],
				['42\t', 'Dana'],
			]),
			[],
		);
		expect(blocking).toStrictEqual([
			{ firstLine: 2, line: 3, reason: 'numberDuplicate' },
			{ firstLine: 2, line: 5, reason: 'numberDuplicate' },
		]);
	});

	it('blocks a number over 50 characters', () => {
		const { rows, blocking } = transformRows(
			memberPayload([
				['1'.repeat(51), 'Anna'],
				['2'.repeat(50), 'Ben'],
			]),
			[],
		);
		expect(blocking).toStrictEqual([{ line: 2, reason: 'numberTooLong' }]);
		expect(rows[1]?.values.memberNumber).toBe('2'.repeat(50));
	});

	it('blocks more than 10 000 rows', () => {
		const tooMany = memberPayload(numbers(10_001));
		expect(transformRows(tooMany, [])).toStrictEqual({
			blocking: [{ count: 10_001, reason: 'tooManyRows' }],
			fieldIssues: [],
			rows: [],
		});
		const atLimit = transformRows(memberPayload(numbers(10_000)), []);
		expect(atLimit.blocking).toStrictEqual([]);
		expect(atLimit.rows).toHaveLength(10_000);
	});

	it('blocks a member import without member number column', () => {
		const { blocking } = transformRows(
			withoutColumn(
				memberPayload([
					['1', 'Anna'],
					['2', 'Ben'],
				]),
				'Nr.',
			),
			[],
		);
		expect(blocking).toStrictEqual([{ reason: 'keyNotMapped' }]);
	});

	it('blocks a field mapped twice', () => {
		const { blocking } = transformRows(
			withColumns(
				memberPayload([['1', 'Anna']]),
				[
					{ header: 'Mail', target: { field: 'email', type: 'field' } },
					{ header: 'Mail 2', target: { field: 'email', type: 'field' } },
				],
				[['anna@example.org', 'anna@example.org']],
			),
			[],
		);
		expect(blocking).toStrictEqual([{ field: 'email', reason: 'fieldMappedTwice' }]);
	});

	it('blocks a partner row without customer number and email', () => {
		const { rows, blocking } = transformRows(
			partnerPayload([
				['100001', 'Körner', 'Max', 'max.koerner@example.org', 'männlich'],
				['-', 'Weiß', 'Lena', '-', 'weiblich'],
				['', 'Abel', 'Anna', 'anna@', 'weiblich'],
				['-', 'Huber', 'Jo', 'jo.huber@example.org', 'keine Angabe'],
			]),
			[],
		);
		expect(blocking).toStrictEqual([
			{ line: 3, reason: 'partnerKeyMissing' },
			{ line: 4, reason: 'partnerKeyMissing' },
		]);
		expect(rows[3]?.values).toStrictEqual({
			email: 'jo.huber@example.org',
			firstName: 'Jo',
			gender: 'unspecified',
			lastName: 'Huber',
		});
		expect(rows[3]?.groups).toBeNull();
	});

	it('blocks duplicate customer numbers', () => {
		const { blocking } = transformRows(
			partnerPayload([
				['100001', 'Körner'],
				['100002', 'Weiß'],
				['100001', 'Abel'],
			]),
			[],
		);
		expect(blocking).toStrictEqual([{ firstLine: 2, line: 4, reason: 'numberDuplicate' }]);
	});

	it('needs the customer number or the email column for partners', () => {
		const both = partnerPayload([['100001', 'Körner', 'Max', 'max.koerner@example.org']]);
		const emailOnly = withoutColumn(both, 'Nr.');
		const numberOnly = withoutColumn(both, 'E-Mail');
		const neither = withoutColumn(emailOnly, 'E-Mail');
		expect(transformRows(emailOnly, []).blocking).toStrictEqual([]);
		expect(transformRows(numberOnly, []).blocking).toStrictEqual([]);
		expect(transformRows(neither, []).blocking).toStrictEqual([{ reason: 'keyNotMapped' }]);
	});

	it('moves the last name into the organization when the first name is empty', () => {
		const payload = partnerPayload(PARTNER_ROWS, { organizationFromLastName: true });
		const { rows } = transformRows(payload, []);
		expect(rows[0]?.values).toStrictEqual({
			customerNumber: '100001',
			email: 'info@baeckerei-koerner.example',
			gender: 'unspecified',
			lastName: null,
			organization: 'Bäckerei Körner GmbH',
		});
		expect(rows[0]?.blank).toStrictEqual(['firstName']);
		expect(rows[1]?.values).toMatchObject({ firstName: 'Lena', lastName: 'Müller' });
		expect(rows[1]?.values).not.toHaveProperty('organization');
	});

	it('keeps the last name without the organization rule', () => {
		const { rows } = transformRows(partnerPayload(PARTNER_ROWS), []);
		expect(rows[0]?.values).toMatchObject({ lastName: 'Bäckerei Körner GmbH' });
		expect(rows[0]?.values).not.toHaveProperty('organization');
	});

	it('keeps a mapped organization and leaves members alone', () => {
		const partner = withColumns(
			partnerPayload(
				[
					['100001', 'Körner', '-'],
					['100002', 'Weiß', ''],
				],
				{
					organizationFromLastName: true,
				},
			),
			[{ header: 'Firma', target: { field: 'organization', type: 'field' } }],
			[['Bäckerei Körner GmbH'], ['-']],
		);
		const { rows } = transformRows(partner, []);
		expect(rows[0]?.values).toMatchObject({
			lastName: 'Körner',
			organization: 'Bäckerei Körner GmbH',
		});
		expect(rows[1]?.values).toMatchObject({ lastName: null, organization: 'Weiß' });
		expect(rows[1]?.blank).toStrictEqual(['firstName', 'email', 'gender']);

		const member = transformRows(
			memberPayload([['1', '-', 'Abel']], { organizationFromLastName: true }),
			[],
		);
		expect(member.rows[0]?.values).toStrictEqual({ lastName: 'Abel', memberNumber: '1' });
	});

	it('validates date custom fields and blocks a taken custom field name', () => {
		const payload = withColumns(
			memberPayload([
				['1', 'Anna'],
				['2', 'Ben'],
			]),
			[
				{ header: 'Ehrenamt', target: { customFieldId: SINCE_ID, type: 'customField' } },
				{ header: 'Schrank', target: { customFieldId: SPIND_ID, type: 'customField' } },
				{ header: 'Trikot', target: { name: 'Trikot', type: 'newCustomField', valueType: 'text' } },
				{
					header: 'Lizenz',
					target: { name: 'Lizenz bis', type: 'newCustomField', valueType: 'date' },
				},
			],
			[
				['01.03.2020', 'B12', 'L', '2027-06-30'],
				['31.02.2020', '-', 'x'.repeat(501), '30.06.27'],
			],
		);
		const { rows, fieldIssues, blocking } = transformRows(payload, CUSTOM_FIELDS);
		expect(blocking).toStrictEqual([]);
		expect(rows.map((row) => row.custom)).toStrictEqual([
			{
				[SINCE_ID]: '2020-03-01',
				[SPIND_ID]: 'B12',
				'new:Lizenz bis': '2027-06-30',
				'new:Trikot': 'L',
			},
			{},
		]);
		expect(fieldIssues).toStrictEqual([
			{ column: 'Ehrenamt', line: 3, reason: 'invalidDate' },
			{ column: 'Trikot', line: 3, reason: 'tooLong' },
			{ column: 'Lizenz', line: 3, reason: 'twoDigitYear' },
		]);
		expect(rows[1]?.blank).toStrictEqual(
			expect.arrayContaining([
				`custom:${SINCE_ID}`,
				`custom:${SPIND_ID}`,
				'custom:new:Trikot',
				'custom:new:Lizenz bis',
			]),
		);

		const taken = withColumns(
			memberPayload([['1', 'Anna']]),
			[{ header: 'Schrank', target: { name: 'SPIND', type: 'newCustomField', valueType: 'text' } }],
			[['B12']],
		);
		expect(transformRows(taken, CUSTOM_FIELDS).blocking).toStrictEqual([
			{ column: 'Schrank', reason: 'customFieldInvalid' },
		]);
	});

	it('accepts a custom field name of 60 characters', () => {
		const payload = withColumns(
			memberPayload([['1']]),
			[
				{
					header: 'Lang',
					target: { name: 'x'.repeat(60), type: 'newCustomField', valueType: 'text' },
				},
			],
			[['ja']],
		);
		expect(transformRows(payload, CUSTOM_FIELDS).blocking).toStrictEqual([]);
	});

	it.each<[string, ImportPayload['columns'], readonly CustomFieldRecord[]]>([
		[
			'an empty name',
			[{ header: 'Trikot', target: { name: ' ', type: 'newCustomField', valueType: 'text' } }],
			CUSTOM_FIELDS,
		],
		[
			'a name over 60 characters',
			[
				{
					header: 'Trikot',
					target: { name: 'x'.repeat(61), type: 'newCustomField', valueType: 'text' },
				},
			],
			CUSTOM_FIELDS,
		],
		[
			'a name twice',
			[
				{ header: 'Größe', target: { name: 'Trikot', type: 'newCustomField', valueType: 'text' } },
				{ header: 'Trikot', target: { name: 'trikot', type: 'newCustomField', valueType: 'date' } },
			],
			CUSTOM_FIELDS,
		],
		[
			'an unknown custom field',
			[{ header: 'Trikot', target: { customFieldId: GONE_ID, type: 'customField' } }],
			CUSTOM_FIELDS,
		],
		[
			'a custom field twice',
			[
				{ header: 'Schrank', target: { customFieldId: SPIND_ID, type: 'customField' } },
				{ header: 'Trikot', target: { customFieldId: SPIND_ID, type: 'customField' } },
			],
			CUSTOM_FIELDS,
		],
		[
			'a custom field of the partners',
			[{ header: 'Trikot', target: { customFieldId: SPIND_ID, type: 'customField' } }],
			[{ id: SPIND_ID, kind: 'partner', name: 'Spind', protection: 'base', type: 'text' }],
		],
	])('blocks %s', (_name, columns, customFields) => {
		const payload = withColumns(memberPayload([['1']]), columns, [columns.map(() => 'L')]);
		expect(transformRows(payload, customFields).blocking).toStrictEqual([
			{ column: 'Trikot', reason: 'customFieldInvalid' },
		]);
	});
});
