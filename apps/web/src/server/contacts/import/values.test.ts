import { describe, expect, it } from 'vite-plus/test';

import {
	cleanText,
	DEFAULT_EMPTY_MARKERS,
	DEFAULT_GROUP_SEPARATORS,
	isEmptyValue,
	isValidContactEmail,
	MAX_LENGTH,
	splitGroups,
	suggestGender,
	uniqueIgnoringCase,
} from './values';

describe(cleanText, () => {
	it('strips control characters and trims', () => {
		expect(cleanText(' 0042\u0007\t')).toBe('0042');
	});

	it('reads a missing cell as empty text', () => {
		expect(cleanText(null)).toBe('');
	});

	it('keeps words apart at line breaks and tabs', () => {
		expect(cleanText('Hauptstraße 1\r\nHinterhaus\tlinks')).toBe('Hauptstraße 1 Hinterhaus links');
	});

	it('composes decomposed umlauts', () => {
		expect(cleanText('männlich')).toBe('männlich');
	});
});

describe(isEmptyValue, () => {
	it.each([
		['', true],
		['-', true],
		['0', false],
		['Anna', false],
	])('treats %j as empty: %s', (value, empty) => {
		expect(isEmptyValue(value, DEFAULT_EMPTY_MARKERS)).toBe(empty);
	});

	it('uses the given markers and always treats an empty cell as empty', () => {
		expect(isEmptyValue('n/a', ['n/a'])).toBe(true);
		expect(isEmptyValue('-', ['n/a'])).toBe(false);
		expect(isEmptyValue('', [])).toBe(true);
	});

	it('ignores spaces around a marker', () => {
		expect(isEmptyValue('n/a', [' n/a '])).toBe(true);
	});
});

describe(splitGroups, () => {
	it('splits groups at comma and semicolon', () => {
		expect(
			splitGroups(
				'Fußball, Danceaerobic;fußball; -',
				DEFAULT_GROUP_SEPARATORS,
				DEFAULT_EMPTY_MARKERS,
			),
		).toStrictEqual(['Fußball', 'Danceaerobic']);
	});

	it('keeps the whole value without separators', () => {
		expect(splitGroups('Fußball, Danceaerobic', [], DEFAULT_EMPTY_MARKERS)).toStrictEqual([
			'Fußball, Danceaerobic',
		]);
	});

	it('returns no group for an empty value', () => {
		expect(splitGroups('', DEFAULT_GROUP_SEPARATORS, DEFAULT_EMPTY_MARKERS)).toStrictEqual([]);
		expect(splitGroups('-', DEFAULT_GROUP_SEPARATORS, DEFAULT_EMPTY_MARKERS)).toStrictEqual([]);
	});

	it('splits at a separator of several characters', () => {
		expect(splitGroups('Fußball / Tischtennis', [' / '], DEFAULT_EMPTY_MARKERS)).toStrictEqual([
			'Fußball',
			'Tischtennis',
		]);
	});
});

describe(uniqueIgnoringCase, () => {
	it('keeps the first spelling of each value', () => {
		expect(uniqueIgnoringCase(['Sponsor', 'Presse', 'SPONSOR', 'presse', 'Sponsor'])).toStrictEqual(
			['Sponsor', 'Presse'],
		);
	});
});

describe(suggestGender, () => {
	it.each([
		['weiblich', 'female'],
		['Weiblich', 'female'],
		['w', 'female'],
		['female', 'female'],
		['männlich', 'male'],
		['M', 'male'],
		['male', 'male'],
		['divers', 'diverse'],
		['d', 'diverse'],
		['diverse', 'diverse'],
		['keine Angabe', 'unspecified'],
		['Herr', null],
		['', null],
	])('suggestGender(%j) is %s', (value, gender) => {
		expect(suggestGender(value)).toBe(gender);
	});
});

describe(isValidContactEmail, () => {
	it.each([
		['anna.abel@example.org', true],
		['Anna.Abel@Example.org', true],
		['anna@', false],
		['anna.abel', false],
		['admin@localhost', false],
		[`${'a'.repeat(250)}@example.org`, false],
	])('isValidContactEmail(%j) is %s', (value, valid) => {
		expect(isValidContactEmail(value)).toBe(valid);
	});
});

describe('limits and defaults', () => {
	it('uses the lengths of decision 10', () => {
		expect(MAX_LENGTH).toStrictEqual({
			customText: 500,
			email: 254,
			group: 100,
			name: 200,
			number: 50,
			postalCode: 20,
		});
	});

	it('treats empty cells and "-" as empty and splits groups at comma and semicolon', () => {
		expect(DEFAULT_EMPTY_MARKERS).toStrictEqual(['', '-']);
		expect(DEFAULT_GROUP_SEPARATORS).toStrictEqual([',', ';']);
	});
});
