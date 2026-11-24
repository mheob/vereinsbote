import { describe, expect, it } from 'vite-plus/test';

import {
	DEFAULT_STALE_IMPORT_WEEKS,
	isValidStaleImportWeeks,
	MAX_STALE_IMPORT_WEEKS,
	MIN_STALE_IMPORT_WEEKS,
} from './stale-weeks';

describe(isValidStaleImportWeeks, () => {
	it.each([MIN_STALE_IMPORT_WEEKS, DEFAULT_STALE_IMPORT_WEEKS, MAX_STALE_IMPORT_WEEKS])(
		'takes %i weeks',
		(weeks) => {
			expect(isValidStaleImportWeeks(weeks)).toBe(true);
		},
	);

	it.each([0, -1, 53, 2.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %d weeks', (weeks) => {
		expect(isValidStaleImportWeeks(weeks)).toBe(false);
	});

	it('names the range of the setting', () => {
		expect([
			MIN_STALE_IMPORT_WEEKS,
			DEFAULT_STALE_IMPORT_WEEKS,
			MAX_STALE_IMPORT_WEEKS,
		]).toStrictEqual([1, 8, 52]);
	});
});
