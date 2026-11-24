import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_IMPORT_OPTIONS, MAX_GENDER_VALUES } from '@/server/contacts/import/mapping';
import type { ColumnTarget } from '@/server/contacts/import/mapping';
import { importPayloadSchema, MAX_IMPORT_ROWS } from '@/server/contacts/import/payload';
import type { ImportPayload } from '@/server/contacts/import/payload';

import { buildPayload, distinctValues, genderChoices, sampleValues } from './build-payload';
import type { BuildPayloadResult, MappingDraft } from './build-payload';
import type { Sheet } from './read-sheet';

const MEMBER_NUMBER: ColumnTarget = { field: 'memberNumber', type: 'field' };
const FIRST_NAME: ColumnTarget = { field: 'firstName', type: 'field' };
const GENDER: ColumnTarget = { field: 'gender', type: 'field' };
const DISCARD: ColumnTarget = { type: 'discard' };

/**
 * A sheet whose rows are lines 2, 3, … of the file.
 *
 * @param headers The headers.
 * @param rows The cells per row.
 * @returns The sheet.
 */
function sheetOf(headers: readonly string[], rows: readonly (readonly (string | null)[])[]): Sheet {
	return {
		headers: [...headers],
		rows: rows.map((cells, index) => ({ cells: [...cells], line: index + 2 })),
	};
}

/**
 * A draft with the default options.
 *
 * @param columns The targets by header.
 * @param changes Other parts of the draft.
 * @returns The draft.
 */
function draftOf(
	columns: MappingDraft['columns'],
	changes: Partial<Omit<MappingDraft, 'columns'>> = {},
): MappingDraft {
	return { columns, filters: [], options: DEFAULT_IMPORT_OPTIONS, ...changes };
}

/**
 * The payload of a built result.
 *
 * @param result The result.
 * @returns The payload.
 * @throws {Error} When the draft was refused.
 */
function payloadOf(result: BuildPayloadResult): ImportPayload {
	if (!result.ok) throw new Error(`The draft was refused: ${result.problem}.`);
	return result.payload;
}

/**
 * A sheet with one column and the given number of rows.
 *
 * @param count The number of rows.
 * @returns The sheet.
 */
function numbersSheet(count: number): Sheet {
	return sheetOf(
		['Nr.'],
		Array.from({ length: count }, (_, index) => [String(index + 1)]),
	);
}

describe(buildPayload, () => {
	it('sends only mapped columns and the rows inside the filters', () => {
		const sheet: Sheet = {
			headers: ['Nr.', 'Vorname', 'Notiz', 'Status'],
			rows: [
				{ cells: ['1001', 'Anna', 'Konto 1234', 'Aktiv'], line: 2 },
				{ cells: ['1002', 'Ben', 'Allergie', 'Passiv'], line: 3 },
				{ cells: ['1003', 'Cem', null, ' aktiv '], line: 5 },
			],
		};
		const draft = draftOf(
			{ Notiz: DISCARD, 'Nr.': MEMBER_NUMBER, Status: { type: 'groups' }, Vorname: FIRST_NAME },
			{ filters: [{ column: 'Status', operator: 'is', value: 'Aktiv' }] },
		);

		const result = buildPayload('member', sheet, draft);

		expect(result).toStrictEqual({
			filteredOut: 1,
			ok: true,
			payload: {
				columns: [
					{ header: 'Nr.', target: MEMBER_NUMBER },
					{ header: 'Vorname', target: FIRST_NAME },
					{ header: 'Status', target: { type: 'groups' } },
				],
				discardedHeaders: ['Notiz'],
				filters: [{ column: 'Status', operator: 'is', value: 'Aktiv' }],
				kind: 'member',
				options: { ...DEFAULT_IMPORT_OPTIONS, genderValues: {} },
				rows: [
					{ cells: ['1001', 'Anna', 'Aktiv'], line: 2 },
					{ cells: ['1003', 'Cem', ' aktiv '], line: 5 },
				],
			},
		});
		const sent = JSON.stringify(result);
		expect(sent).not.toContain('Konto');
		expect(sent).not.toContain('Allergie');
		expect(sent).not.toContain('Ben');
		expect(importPayloadSchema.safeParse(payloadOf(result)).success).toBe(true);
	});

	it('discards columns the draft does not know and ignores targets of absent columns', () => {
		const sheet = sheetOf(['Nr.', 'IBAN'], [['1001', 'DE00 0000']]);
		const result = buildPayload(
			'member',
			sheet,
			draftOf({ 'Nr.': MEMBER_NUMBER, Vorname: FIRST_NAME }),
		);
		expect(result).toMatchObject({
			ok: true,
			payload: {
				columns: [{ header: 'Nr.', target: MEMBER_NUMBER }],
				discardedHeaders: ['IBAN'],
				rows: [{ cells: ['1001'], line: 2 }],
			},
		});
		expect(JSON.stringify(result)).not.toContain('DE00');
	});

	it('requires the member number before the preview', () => {
		const sheet = sheetOf(['Nr.', 'Vorname'], [['1001', 'Anna']]);
		expect(
			buildPayload('member', sheet, draftOf({ 'Nr.': DISCARD, Vorname: FIRST_NAME })),
		).toStrictEqual({ ok: false, problem: 'keyNotMapped' });
	});

	it('requires a customer number or an address for partners', () => {
		const sheet = sheetOf(['Nr.', 'E-Mail'], [['100001', 'info@baeckerei.example']]);
		expect(
			buildPayload('partner', sheet, draftOf({ 'E-Mail': DISCARD, 'Nr.': DISCARD })),
		).toStrictEqual({ ok: false, problem: 'keyNotMapped' });
		expect(
			buildPayload('partner', sheet, draftOf({ 'E-Mail': { field: 'email', type: 'field' } })),
		).toMatchObject({ ok: true });
		expect(
			buildPayload(
				'partner',
				sheet,
				draftOf({ 'Nr.': { field: 'customerNumber', type: 'field' } }),
			),
		).toMatchObject({ ok: true });
	});

	it('refuses a field mapped to two columns', () => {
		const sheet = sheetOf(['Nr.', 'Vorname', 'Rufname'], [['1001', 'Anna', 'Anni']]);
		const draft = draftOf({ 'Nr.': MEMBER_NUMBER, Rufname: FIRST_NAME, Vorname: FIRST_NAME });
		expect(buildPayload('member', sheet, draft)).toStrictEqual({
			ok: false,
			problem: 'fieldMappedTwice',
		});
	});

	it('refuses more than 10 000 rows and empty sheets', () => {
		const draft = draftOf({ 'Nr.': MEMBER_NUMBER });
		expect(buildPayload('member', numbersSheet(MAX_IMPORT_ROWS + 1), draft)).toStrictEqual({
			ok: false,
			problem: 'tooManyRows',
		});
		expect(buildPayload('member', numbersSheet(MAX_IMPORT_ROWS), draft)).toMatchObject({
			ok: true,
		});
		expect(buildPayload('member', numbersSheet(0), draft)).toStrictEqual({
			ok: false,
			problem: 'noRows',
		});
	});

	it('refuses a file whose rows all fall outside the filters', () => {
		const draft = draftOf(
			{ 'Nr.': MEMBER_NUMBER },
			{ filters: [{ column: 'Status', operator: 'is', value: 'Aktiv' }] },
		);
		expect(buildPayload('member', numbersSheet(3), draft)).toStrictEqual({
			ok: false,
			problem: 'noRows',
		});
	});

	it('sends the translation of every gender value of the file, chosen or suggested', () => {
		const sheet = sheetOf(
			['Nr.', 'Geschlecht'],
			[
				['1', 'männlich'],
				['2', 'weiblich'],
				['3', 'X'],
				['4', 'Divers'],
				['5', '-'],
			],
		);
		const draft = draftOf(
			{ Geschlecht: GENDER, 'Nr.': MEMBER_NUMBER },
			{
				options: {
					...DEFAULT_IMPORT_OPTIONS,
					genderValues: { früher: 'male', weiblich: 'diverse' },
				},
			},
		);
		expect(buildPayload('member', sheet, draft)).toMatchObject({
			ok: true,
			payload: {
				options: { genderValues: { Divers: 'diverse', männlich: 'male', weiblich: 'diverse' } },
			},
		});
	});
});

describe(genderChoices, () => {
	it('lists the values of the gender column with the chosen or suggested gender', () => {
		const sheet = sheetOf(['Geschlecht'], [['weiblich'], ['W'], ['unbekannt'], ['weiblich']]);
		const draft = draftOf(
			{ Geschlecht: GENDER },
			{ options: { ...DEFAULT_IMPORT_OPTIONS, genderValues: { W: 'diverse' } } },
		);
		expect(genderChoices(sheet, draft)).toStrictEqual([
			{ gender: 'female', value: 'weiblich' },
			{ gender: 'diverse', value: 'W' },
			{ gender: null, value: 'unbekannt' },
		]);
	});

	it('is empty without a gender column', () => {
		const sheet = sheetOf(['Geschlecht'], [['weiblich']]);
		expect(genderChoices(sheet, draftOf({ Geschlecht: DISCARD }))).toStrictEqual([]);
	});
});

describe(sampleValues, () => {
	it('picks up to three distinct sample values', () => {
		const sheet = sheetOf(['A'], [['a'], ['a'], [''], ['b'], ['c'], ['d']]);
		expect(sampleValues(sheet, 'A')).toStrictEqual(['a', 'b', 'c']);
	});

	it('skips blank cells, trims and takes another maximum', () => {
		const sheet = sheetOf(
			['A', 'B'],
			[
				[null, ' x '],
				['  ', 'y'],
				['z', 'x'],
			],
		);
		expect(sampleValues(sheet, 'A')).toStrictEqual(['z']);
		expect(sampleValues(sheet, 'B', 1)).toStrictEqual(['x']);
		expect(sampleValues(sheet, 'C')).toStrictEqual([]);
	});
});

describe(distinctValues, () => {
	it('lists each cleaned value once, without empty values', () => {
		const sheet = sheetOf(
			['Geschlecht'],
			[['männlich'], [' weiblich '], ['-'], [null], ['männlich'], ['keine Angabe']],
		);
		expect(distinctValues(sheet, 'Geschlecht', ['', '-'])).toStrictEqual([
			'männlich',
			'weiblich',
			'keine Angabe',
		]);
	});

	it('stops at the number of values a translation takes', () => {
		const sheet = sheetOf(
			['Geschlecht'],
			Array.from({ length: MAX_GENDER_VALUES + 5 }, (_, index) => [`Wert ${index}`]),
		);
		const values = distinctValues(sheet, 'Geschlecht', ['']);
		expect(values).toHaveLength(MAX_GENDER_VALUES);
		expect(values.at(-1)).toBe(`Wert ${MAX_GENDER_VALUES - 1}`);
	});
});
