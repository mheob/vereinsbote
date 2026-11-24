import { describe, expect, it } from 'vite-plus/test';

import type { ContactField } from '@/server/contacts/fields';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import {
	DEFAULT_IMPORT_OPTIONS,
	mappingChanges,
	MAX_COLUMNS,
	MAX_EMPTY_MARKERS,
	MAX_FILTER_RULES,
	MAX_GENDER_VALUES,
	MAX_GROUP_SEPARATORS,
	MAX_HEADER_LENGTH,
	MAX_MARKER_LENGTH,
	rowPassesFilters,
	savedMappingSchema,
	suggestMapping,
	suggestTarget,
} from './mapping';
import type { ColumnTarget, FilterRule, SavedMapping } from './mapping';

const SPIND_ID = '0b9a4c39-3f6e-4d0b-9a64-0c4c3b0f7a11';
const GONE_ID = '5d1f8f2e-7c2a-4f55-8a0e-2b7d9c6e4a22';

const field = (name: ContactField): ColumnTarget => ({ field: name, type: 'field' });
const DISCARD: ColumnTarget = { type: 'discard' };
const GROUPS: ColumnTarget = { type: 'groups' };

const SPIND: CustomFieldRecord = {
	id: SPIND_ID,
	kind: 'member',
	name: 'Spind',
	protection: 'protected',
	type: 'text',
};

const EXPORT = [
	'Nr.',
	'Vorname',
	'Nachname',
	'Geburtstag',
	'E-Mail',
	'Typ',
	'Status',
	'Mitglied seit',
	'Mitglied bis',
	'Abteilungen',
	'Geschlecht',
];

function savedWith(columns: Readonly<Record<string, ColumnTarget>>): SavedMapping {
	return { columns, filters: [], options: DEFAULT_IMPORT_OPTIONS };
}

/**
 * Distinct short labels.
 *
 * @param count The number of labels.
 * @returns `c0`, `c1`, …
 */
function labels(count: number): string[] {
	return Array.from({ length: count }, (_label, index) => `c${index}`);
}

/** A saved mapping with every list at its limit. */
const AT_LIMITS: SavedMapping = {
	columns: Object.fromEntries(labels(MAX_COLUMNS).map((header) => [header, DISCARD])),
	filters: labels(MAX_FILTER_RULES).map((column) => ({ column, operator: 'is', value: '' })),
	options: {
		emptyMarkers: labels(MAX_EMPTY_MARKERS),
		genderValues: Object.fromEntries(labels(MAX_GENDER_VALUES).map((value) => [value, 'female'])),
		groupSeparators: labels(MAX_GROUP_SEPARATORS),
		organizationFromLastName: false,
	},
};

const LONG_MARKER = 'x'.repeat(MAX_MARKER_LENGTH + 1);
const LONG_HEADER = 'x'.repeat(MAX_HEADER_LENGTH + 1);

describe(suggestTarget, () => {
	it('suggests the customer number for Nr. in a partner export', () => {
		expect(suggestTarget('Nr.', 'partner')).toStrictEqual(field('customerNumber'));
	});

	it.each<[string, ColumnTarget]>([
		['Nr', field('memberNumber')],
		['  nr.  ', field('memberNumber')],
		['Mitgliedsnummer', field('memberNumber')],
		['Firma', field('organization')],
		['Email', field('email')],
		['E-MAIL-ADRESSE', field('email')],
		['Geburtsdatum', field('birthDate')],
		['Straße', field('street')],
		['Strasse', field('street')],
		['PLZ', field('postalCode')],
		['Ort', field('city')],
		['Eintritt', field('entryDate')],
		['Eintrittsdatum', field('entryDate')],
		['Austritt', field('exitDate')],
		['Austritt am', field('exitDate')],
		['Austrittsdatum', field('exitDate')],
		['Gruppen', GROUPS],
		['Kundennummer', DISCARD],
		['Notiz', DISCARD],
		['', DISCARD],
	])('suggests for the member header %j', (header, target) => {
		expect(suggestTarget(header, 'member')).toStrictEqual(target);
	});

	it.each<[string, ColumnTarget]>([
		['Kundennummer', field('customerNumber')],
		['Nachname', field('lastName')],
		['Vorname', field('firstName')],
		['E-Mail', field('email')],
		['Geschlecht', field('gender')],
		['Geburtstag', field('birthDate')],
		['Firma', field('organization')],
		['Mitgliedsnummer', DISCARD],
		['Mitglied seit', DISCARD],
		['Mitglied bis', DISCARD],
		['Abteilungen', DISCARD],
		['Status', DISCARD],
		['Typ', DISCARD],
	])('suggests for the partner header %j', (header, target) => {
		expect(suggestTarget(header, 'partner')).toStrictEqual(target);
	});
});

describe(suggestMapping, () => {
	it('suggests the targets of the member export', () => {
		expect(suggestMapping(EXPORT, 'member', null, [])).toStrictEqual({
			Abteilungen: GROUPS,
			'E-Mail': field('email'),
			Geburtstag: field('birthDate'),
			Geschlecht: field('gender'),
			'Mitglied bis': field('exitDate'),
			'Mitglied seit': field('entryDate'),
			Nachname: field('lastName'),
			'Nr.': field('memberNumber'),
			Status: GROUPS,
			Typ: DISCARD,
			Vorname: field('firstName'),
		});
	});

	it('prefers the saved mapping and reports missing and new columns', () => {
		const saved = savedWith({ Nachname: DISCARD, Notiz: GROUPS, 'Nr.': field('memberNumber') });
		expect(suggestMapping(['Nr.', 'Nachname', 'Ort'], 'member', saved, [])).toStrictEqual({
			Nachname: DISCARD,
			'Nr.': field('memberNumber'),
			Ort: field('city'),
		});
		expect(mappingChanges(['Nr.', 'Nachname', 'Ort'], saved)).toStrictEqual({
			added: ['Ort'],
			missing: ['Notiz'],
		});
	});

	it('keeps a saved custom field that still exists', () => {
		const saved = savedWith({ Schrank: { customFieldId: SPIND_ID, type: 'customField' } });
		expect(suggestMapping(['Schrank'], 'member', saved, [SPIND])).toStrictEqual({
			Schrank: { customFieldId: SPIND_ID, type: 'customField' },
		});
	});

	it('drops a saved custom field that no longer exists', () => {
		const saved = savedWith({
			Notiz: { customFieldId: GONE_ID, type: 'customField' },
			Ort: { customFieldId: GONE_ID, type: 'customField' },
		});
		expect(suggestMapping(['Ort', 'Notiz'], 'member', saved, [SPIND])).toStrictEqual({
			Notiz: DISCARD,
			Ort: field('city'),
		});
	});

	it('drops a saved custom field of the other kind', () => {
		const partnerField: CustomFieldRecord = { ...SPIND, kind: 'partner' };
		const saved = savedWith({ Spind: { customFieldId: SPIND_ID, type: 'customField' } });
		expect(suggestMapping(['Spind'], 'member', saved, [partnerField])).toStrictEqual({
			Spind: DISCARD,
		});
	});

	it('drops a saved target the kind does not have', () => {
		const saved = savedWith({ Abteilungen: GROUPS, 'Nr.': field('memberNumber') });
		expect(suggestMapping(['Nr.', 'Abteilungen'], 'partner', saved, [])).toStrictEqual({
			Abteilungen: DISCARD,
			'Nr.': field('customerNumber'),
		});
	});

	it('suggests a field only for its first column', () => {
		expect(suggestMapping(['E-Mail', 'Email', 'E-Mail-Adresse'], 'member', null, [])).toStrictEqual(
			{
				'E-Mail': field('email'),
				'E-Mail-Adresse': DISCARD,
				Email: DISCARD,
			},
		);
		const saved = savedWith({ Mail: field('email') });
		expect(suggestMapping(['E-Mail', 'Mail'], 'member', saved, [])).toStrictEqual({
			'E-Mail': DISCARD,
			Mail: field('email'),
		});
	});

	it('offers groups to several columns', () => {
		expect(suggestMapping(['Status', 'Abteilungen', 'Gruppen'], 'member', null, [])).toStrictEqual({
			Abteilungen: GROUPS,
			Gruppen: GROUPS,
			Status: GROUPS,
		});
	});
});

describe(mappingChanges, () => {
	it('reports no change for the same columns', () => {
		const saved = savedWith({ Nachname: DISCARD, 'Nr.': field('memberNumber') });
		expect(mappingChanges(['Nachname', 'Nr.'], saved)).toStrictEqual({ added: [], missing: [] });
	});

	it('does not miss a discarded column', () => {
		const saved = savedWith({ 'Nr.': field('memberNumber'), Typ: DISCARD });
		expect(mappingChanges(['Nr.'], saved)).toStrictEqual({ added: [], missing: [] });
	});
});

describe(rowPassesFilters, () => {
	const MARKERS = DEFAULT_IMPORT_OPTIONS.emptyMarkers;

	it('keeps rows that match all filter rules', () => {
		const rules: FilterRule[] = [
			{ column: 'Status', operator: 'is', value: 'Aktiv' },
			{ column: 'Typ', operator: 'isNot', value: 'Kontakt' },
		];
		expect(rowPassesFilters({ Status: 'Aktiv', Typ: 'Mitglied' }, rules, MARKERS)).toBe(true);
		expect(rowPassesFilters({ Status: 'Passiv', Typ: 'Mitglied' }, rules, MARKERS)).toBe(false);
		expect(rowPassesFilters({ Status: 'Aktiv', Typ: 'Kontakt' }, rules, MARKERS)).toBe(false);
		expect(
			rowPassesFilters({ Status: '-' }, [{ column: 'Status', operator: 'is', value: '' }], MARKERS),
		).toBe(true);
	});

	it('keeps every row without rules', () => {
		expect(rowPassesFilters({ Status: 'Passiv' }, [], MARKERS)).toBe(true);
	});

	it('treats missing cells and empty markers as empty', () => {
		const notEmpty: FilterRule[] = [{ column: 'Status', operator: 'isNot', value: '-' }];
		expect(rowPassesFilters({}, notEmpty, MARKERS)).toBe(false);
		expect(rowPassesFilters({ Status: null }, notEmpty, MARKERS)).toBe(false);
		expect(rowPassesFilters({ Status: 'Aktiv' }, notEmpty, MARKERS)).toBe(true);
	});

	it('compares cleaned values without case', () => {
		const rules: FilterRule[] = [{ column: 'Status', operator: 'is', value: ' aktiv' }];
		expect(rowPassesFilters({ Status: 'Aktiv\t' }, rules, MARKERS)).toBe(true);
	});
});

describe('the saved mapping schema', () => {
	it('reads a saved mapping', () => {
		const saved: SavedMapping = {
			columns: {
				Notiz: DISCARD,
				'Nr.': field('memberNumber'),
				Spind: { customFieldId: SPIND_ID, type: 'customField' },
				Status: GROUPS,
				Trikot: { name: 'Trikot', type: 'newCustomField', valueType: 'text' },
			},
			filters: [{ column: 'Status', operator: 'is', value: 'Aktiv' }],
			options: { ...DEFAULT_IMPORT_OPTIONS, genderValues: { weiblich: 'female' } },
		};
		const stored = structuredClone(saved);
		expect(savedMappingSchema.parse(stored)).toStrictEqual(saved);
	});

	const valid = savedWith({});

	it.each([
		['an unknown target', { ...valid, columns: { 'Nr.': { type: 'number' } } }],
		['an unknown field', { ...valid, columns: { 'Nr.': { field: 'salary', type: 'field' } } }],
		[
			'an unknown gender',
			{ ...valid, options: { ...valid.options, genderValues: { Herr: 'mister' } } },
		],
		[
			'an unknown filter operator',
			{ ...valid, filters: [{ column: 'Typ', operator: 'like', value: 'x' }] },
		],
		['a missing option', { ...valid, options: { emptyMarkers: ['-'] } }],
		['too many columns', { ...AT_LIMITS, columns: { ...AT_LIMITS.columns, extra: DISCARD } }],
		['a header over the limit', { ...valid, columns: { [LONG_HEADER]: DISCARD } }],
		[
			'too many filter rules',
			{ ...AT_LIMITS, filters: [...AT_LIMITS.filters, { column: 'x', operator: 'is', value: '' }] },
		],
		[
			'a filter column over the limit',
			{ ...valid, filters: [{ column: LONG_HEADER, operator: 'is', value: '' }] },
		],
		[
			'too many empty markers',
			{
				...AT_LIMITS,
				options: { ...AT_LIMITS.options, emptyMarkers: [...AT_LIMITS.options.emptyMarkers, '-'] },
			},
		],
		[
			'an empty marker over the limit',
			{ ...valid, options: { ...valid.options, emptyMarkers: [LONG_MARKER] } },
		],
		[
			'too many group separators',
			{
				...AT_LIMITS,
				options: {
					...AT_LIMITS.options,
					groupSeparators: [...AT_LIMITS.options.groupSeparators, '/'],
				},
			},
		],
		[
			'a group separator over the limit',
			{ ...valid, options: { ...valid.options, groupSeparators: [LONG_MARKER] } },
		],
		[
			'too many gender values',
			{
				...AT_LIMITS,
				options: {
					...AT_LIMITS.options,
					genderValues: { ...AT_LIMITS.options.genderValues, extra: 'male' },
				},
			},
		],
	])('refuses %s', (_name, input) => {
		expect(savedMappingSchema.safeParse(input).success).toBe(false);
	});

	it('reads a mapping with every list at its limit', () => {
		expect(savedMappingSchema.safeParse(AT_LIMITS).success).toBe(true);
	});

	it('uses limits no real export reaches', () => {
		expect({
			MAX_COLUMNS,
			MAX_EMPTY_MARKERS,
			MAX_FILTER_RULES,
			MAX_GENDER_VALUES,
			MAX_GROUP_SEPARATORS,
			MAX_HEADER_LENGTH,
			MAX_MARKER_LENGTH,
		}).toStrictEqual({
			MAX_COLUMNS: 200,
			MAX_EMPTY_MARKERS: 20,
			MAX_FILTER_RULES: 50,
			MAX_GENDER_VALUES: 200,
			MAX_GROUP_SEPARATORS: 10,
			MAX_HEADER_LENGTH: 200,
			MAX_MARKER_LENGTH: 10,
		});
	});
});
