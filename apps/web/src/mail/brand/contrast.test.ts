import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_BRAND } from './brand-schema';
import { contrastFindings, contrastRatio, readableTextOn } from './contrast';

describe(contrastRatio, () => {
	it('gives 21 for black on white, in both directions', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
	});

	it('gives 1 for equal colours', () => {
		expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
	});

	it('gives about 4.48 for #777777 on white', () => {
		expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
	});

	it('reads upper case hex', () => {
		expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
	});
});

describe(readableTextOn, () => {
	it.each([
		['#0b5394', '#ffffff'],
		['#ffff00', '#000000'],
		['#000000', '#ffffff'],
		['#ffffff', '#000000'],
	])('picks the readable text for %s', (background, expected) => {
		expect(readableTextOn(background)).toBe(expected);
	});
});

describe(contrastFindings, () => {
	it('finds nothing for the default brand', () => {
		expect(contrastFindings(DEFAULT_BRAND.colors)).toStrictEqual([]);
	});

	it('names the pairs below 4.5 with their ratio', () => {
		const findings = contrastFindings({
			...DEFAULT_BRAND.colors,
			background: '#ffffff',
			link: '#777777',
			text: '#777777',
		});
		expect(findings.map((finding) => finding.pair)).toStrictEqual([
			'textOnBackground',
			'linkOnBackground',
		]);
		expect(findings[0]?.ratio).toBeCloseTo(4.48, 2);
	});

	it('never flags the automatic button and footer text: black or white always reaches 4.5', () => {
		// The worst background is mid grey; the better of black and white still gives about 4.6.
		const findings = contrastFindings({
			...DEFAULT_BRAND.colors,
			primary: '#757575',
			secondary: '#757575',
		});
		expect(findings).toStrictEqual([]);
	});
});
