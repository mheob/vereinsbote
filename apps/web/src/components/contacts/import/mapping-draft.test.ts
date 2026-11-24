import { describe, expect, it } from 'vite-plus/test';

import {
	DEFAULT_IMPORT_OPTIONS,
	MAX_CUSTOM_FIELD_NAME_LENGTH,
	MAX_EMPTY_MARKERS,
	MAX_MARKER_LENGTH,
} from '@/server/contacts/import/mapping';
import type { ColumnTarget, SavedMapping } from '@/server/contacts/import/mapping';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import {
	formatEmptyMarkers,
	initialDraft,
	missingFilterColumns,
	parseEmptyMarkers,
	targetKey,
	targetOfKey,
} from './mapping-draft';

const LOCKER: CustomFieldRecord = {
	id: '0f8fad5b-d9cb-469f-a165-70867728950e',
	kind: 'member',
	name: 'Spind',
	protection: 'protected',
	type: 'text',
};

const SAVED: SavedMapping = {
	columns: {
		Abteilungen: { type: 'groups' },
		Mitgliedsnr: { field: 'memberNumber', type: 'field' },
		Spind: { customFieldId: LOCKER.id, type: 'customField' },
		Typ: { type: 'discard' },
	},
	filters: [{ column: 'Typ', operator: 'is', value: 'Mitglied' }],
	options: {
		...DEFAULT_IMPORT_OPTIONS,
		emptyMarkers: ['', '-', 'k. A.'],
		genderValues: { m: 'male' },
		organizationFromLastName: true,
	},
};

describe(initialDraft, () => {
	it('suggests targets from the headers and starts with the default options', () => {
		expect(initialDraft('member', ['Nr.', 'Typ', 'Abteilungen'], null, [])).toStrictEqual({
			columns: {
				Abteilungen: { type: 'groups' },
				'Nr.': { field: 'memberNumber', type: 'field' },
				Typ: { type: 'discard' },
			},
			filters: [],
			options: DEFAULT_IMPORT_OPTIONS,
		});
	});

	it('takes over the saved targets, filters and options', () => {
		const draft = initialDraft('member', ['Mitgliedsnr', 'Spind', 'Typ'], SAVED, [LOCKER]);
		expect(draft.columns).toStrictEqual({
			Mitgliedsnr: { field: 'memberNumber', type: 'field' },
			Spind: { customFieldId: LOCKER.id, type: 'customField' },
			Typ: { type: 'discard' },
		});
		expect(draft.filters).toStrictEqual(SAVED.filters);
		// The organization rule is a partner option only.
		expect(draft.options).toStrictEqual({ ...SAVED.options, organizationFromLastName: false });
		expect(initialDraft('partner', [], SAVED, []).options.organizationFromLastName).toBe(true);
	});
});

describe(targetKey, () => {
	it.each<[ColumnTarget, string]>([
		[{ field: 'email', type: 'field' }, 'field:email'],
		[{ type: 'groups' }, 'groups'],
		[{ customFieldId: LOCKER.id, type: 'customField' }, `customField:${LOCKER.id}`],
		[{ name: 'Spind', type: 'newCustomField', valueType: 'date' }, 'newCustomField'],
		[{ type: 'discard' }, 'discard'],
	])('keys %o as %s', (target, key) => {
		expect(targetKey(target)).toBe(key);
	});
});

describe(targetOfKey, () => {
	const discard: ColumnTarget = { type: 'discard' };

	it('reads the keys of the select back', () => {
		expect(
			targetOfKey('field:email', { current: discard, header: 'Mail', kind: 'partner' }),
		).toStrictEqual({
			field: 'email',
			type: 'field',
		});
		expect(
			targetOfKey('groups', { current: discard, header: 'Status', kind: 'member' }),
		).toStrictEqual({
			type: 'groups',
		});
		expect(
			targetOfKey(`customField:${LOCKER.id}`, {
				current: discard,
				header: 'Spind',
				kind: 'member',
			}),
		).toStrictEqual({ customFieldId: LOCKER.id, type: 'customField' });
		expect(
			targetOfKey('discard', { current: discard, header: 'Typ', kind: 'member' }),
		).toStrictEqual(discard);
	});

	it('names a new custom field after its column and keeps a name already given', () => {
		const long = 'x'.repeat(MAX_CUSTOM_FIELD_NAME_LENGTH + 5);
		expect(
			targetOfKey('newCustomField', { current: discard, header: long, kind: 'member' }),
		).toStrictEqual({
			name: 'x'.repeat(MAX_CUSTOM_FIELD_NAME_LENGTH),
			type: 'newCustomField',
			valueType: 'text',
		});
		const named: ColumnTarget = { name: 'Schlüssel', type: 'newCustomField', valueType: 'date' };
		expect(targetOfKey('newCustomField', { current: named, header: 'Spind', kind: 'member' })).toBe(
			named,
		);
	});

	it('refuses keys the kind does not have', () => {
		expect(
			targetOfKey('field:memberNumber', { current: discard, header: 'Nr.', kind: 'partner' }),
		).toBeNull();
		expect(
			targetOfKey('groups', { current: discard, header: 'Status', kind: 'partner' }),
		).toBeNull();
		expect(
			targetOfKey('customField:x', { current: discard, header: 'Spind', kind: 'member' }),
		).toBeNull();
		expect(
			targetOfKey('field:nonsense', { current: discard, header: 'A', kind: 'member' }),
		).toBeNull();
		expect(targetOfKey('other', { current: discard, header: 'A', kind: 'member' })).toBeNull();
	});
});

describe(parseEmptyMarkers, () => {
	it('reads the markers between commas, the empty cell always included', () => {
		expect(parseEmptyMarkers('-, k. A. ,,-')).toStrictEqual(['', '-', 'k. A.']);
		expect(parseEmptyMarkers('')).toStrictEqual(['']);
	});

	it('refuses more or longer markers than a mapping takes', () => {
		const most = Array.from({ length: MAX_EMPTY_MARKERS - 1 }, (_, index) => `m${index}`);
		expect(parseEmptyMarkers(most.join(','))).toHaveLength(MAX_EMPTY_MARKERS);
		expect(parseEmptyMarkers([...most, 'one more'].join(','))).toBeNull();
		expect(parseEmptyMarkers('y'.repeat(MAX_MARKER_LENGTH))).toHaveLength(2);
		expect(parseEmptyMarkers('y'.repeat(MAX_MARKER_LENGTH + 1))).toBeNull();
	});
});

describe(formatEmptyMarkers, () => {
	it('writes the markers but the empty cell', () => {
		expect(formatEmptyMarkers(['', '-', 'k. A.'])).toBe('-, k. A.');
		expect(formatEmptyMarkers(DEFAULT_IMPORT_OPTIONS.emptyMarkers)).toBe('-');
	});
});

describe(missingFilterColumns, () => {
	it('names the columns of filter rules the file lacks, each once', () => {
		const filters = [
			{ column: 'Typ', operator: 'is', value: 'Mitglied' },
			{ column: 'Status', operator: 'isNot', value: 'Passiv' },
			{ column: 'Status', operator: 'isNot', value: 'Ruhend' },
		] as const;
		expect(missingFilterColumns(['Nr.', 'Typ'], filters)).toStrictEqual(['Status']);
		expect(missingFilterColumns(['Typ', 'Status'], filters)).toStrictEqual([]);
	});
});
