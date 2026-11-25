import { describe, expect, it } from 'vite-plus/test';

import { brandSchema, DEFAULT_BRAND } from './brand-schema';
import { fontFamilyCss } from './fonts';

describe(fontFamilyCss, () => {
	it('puts the wish font before the stack', () => {
		expect(fontFamilyCss('arial', 'Open Sans')).toBe('"Open Sans", Arial, Helvetica, sans-serif');
	});

	it('gives the stack alone without a wish', () => {
		expect(fontFamilyCss('georgia', null)).toBe('Georgia, "Times New Roman", serif');
	});

	it.each(['verdana', 'tahoma', 'trebuchet', 'times'] as const)('has a stack for %s', (stack) => {
		expect(fontFamilyCss(stack, null)).toMatch(/sans-serif$|serif$/u);
	});

	it('refuses a wish that could leave the quotes', () => {
		const result = brandSchema.safeParse({
			...DEFAULT_BRAND,
			fonts: { ...DEFAULT_BRAND.fonts, textWish: '";}' },
		});
		expect(result.success).toBe(false);
	});
});
