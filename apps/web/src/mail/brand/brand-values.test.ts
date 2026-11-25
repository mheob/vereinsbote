import { describe, expect, it } from 'vite-plus/test';

import { BUILTIN_PLACEHOLDERS } from '@/mail/placeholders/registry';

import { DEFAULT_BRAND } from './brand-schema';
import type { Brand } from './brand-schema';
import { brandPlaceholderValues } from './brand-values';

const ORIGIN = 'https://verein.example';
const ID = 'a'.repeat(22);
const LOGO = { alt: 'Logo', height: 60, mediaId: ID, type: 'png', width: 200 } as const;

describe(brandPlaceholderValues, () => {
	it('gives the required values of the default brand', () => {
		const values = brandPlaceholderValues(DEFAULT_BRAND, ORIGIN);
		expect(values.get('brand.name')).toBe('Verein');
		expect(values.get('brand.primaryColor')).toBe(DEFAULT_BRAND.colors.primary);
		expect(values.get('brand.fontFamily')).toBe('Arial, Helvetica, sans-serif');
		expect(values.get('brand.headingFontFamily')).toBe('Arial, Helvetica, sans-serif');
	});

	it('leaves out empty optional values', () => {
		const values = brandPlaceholderValues(DEFAULT_BRAND, ORIGIN);
		for (const key of [
			'brand.website',
			'brand.imprintUrl',
			'brand.privacyUrl',
			'brand.address',
			'brand.register',
			'brand.logoUrl',
			'brand.footerLogoUrl',
		]) {
			expect(values.has(key)).toBe(false);
		}
	});

	it('makes absolute logo URLs', () => {
		const brand: Brand = { ...DEFAULT_BRAND, footerLogo: LOGO, headerLogo: LOGO };
		const values = brandPlaceholderValues(brand, ORIGIN);
		expect(values.get('brand.logoUrl')).toBe(`https://verein.example/media/${ID}.png`);
		expect(values.get('brand.footerLogoUrl')).toBe(`https://verein.example/media/${ID}.png`);
	});

	it('maps the footer fields to their brand keys', () => {
		const brand: Brand = {
			...DEFAULT_BRAND,
			footer: {
				...DEFAULT_BRAND.footer,
				address: 'Musterweg 1',
				imprintUrl: 'https://verein.example/impressum',
				privacyUrl: 'https://verein.example/datenschutz',
				register: 'AG Musterstadt VR 1',
				websiteUrl: 'https://verein.example',
			},
		};
		expect(Object.fromEntries(brandPlaceholderValues(brand, ORIGIN))).toMatchObject({
			'brand.address': 'Musterweg 1',
			'brand.imprintUrl': 'https://verein.example/impressum',
			'brand.privacyUrl': 'https://verein.example/datenschutz',
			'brand.register': 'AG Musterstadt VR 1',
			'brand.website': 'https://verein.example',
		});
	});

	it('puts the wish font before the stack', () => {
		const fonts = { ...DEFAULT_BRAND.fonts, headingWish: 'Open Sans' };
		const values = brandPlaceholderValues({ ...DEFAULT_BRAND, fonts }, ORIGIN);
		expect(values.get('brand.headingFontFamily')).toBe('"Open Sans", Arial, Helvetica, sans-serif');
	});

	it('emits only keys the registry knows as brand placeholders', () => {
		const brand: Brand = { ...DEFAULT_BRAND, footerLogo: LOGO, headerLogo: LOGO };
		const known = new Set(
			BUILTIN_PLACEHOLDERS.filter((p) => p.group === 'brand').map((p) => p.key),
		);
		for (const key of brandPlaceholderValues(brand, ORIGIN).keys()) {
			expect(known.has(key)).toBe(true);
		}
	});

	it('tolerates a trailing slash on the origin', () => {
		const brand: Brand = { ...DEFAULT_BRAND, headerLogo: LOGO };
		expect(brandPlaceholderValues(brand, `${ORIGIN}/`).get('brand.logoUrl')).toBe(
			`https://verein.example/media/${ID}.png`,
		);
	});
});
