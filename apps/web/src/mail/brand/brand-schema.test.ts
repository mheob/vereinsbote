/* oxlint-disable no-script-url -- the tests feed such URLs on purpose to see them refused */
import { describe, expect, it } from 'vite-plus/test';

import { brandSchema, DEFAULT_BRAND } from './brand-schema';
import type { Brand } from './brand-schema';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function withFooter(footer: Partial<Mutable<Brand['footer']>>): Brand {
	return { ...DEFAULT_BRAND, footer: { ...DEFAULT_BRAND.footer, ...footer } };
}

function parseBrand(value: unknown): ReturnType<typeof brandSchema.safeParse> {
	return brandSchema.safeParse(value);
}

const LINK = { display: 'text', label: 'Instagram', url: 'https://instagram.com/verein' } as const;

describe(parseBrand, () => {
	it('accepts the default brand', () => {
		expect(parseBrand(DEFAULT_BRAND).success).toBe(true);
	});

	it('accepts five links and refuses six', () => {
		const links = Array.from({ length: 6 }, () => ({ ...LINK }));
		const five = parseBrand(withFooter({ links: links.slice(0, 5) }));
		const six = parseBrand(withFooter({ links }));
		expect([five.success, six.success]).toStrictEqual([true, false]);
	});

	it.each(['javascript:alert(1)', 'http://example.org', 'tel:+49123', 'data:text/html,x'])(
		'refuses %s as imprint URL',
		(imprintUrl) => {
			expect(parseBrand(withFooter({ imprintUrl })).success).toBe(false);
		},
	);

	it('accepts https and mailto', () => {
		const footer = {
			imprintUrl: 'https://verein.example/impressum',
			websiteUrl: 'mailto:a@b.example',
		};
		expect(parseBrand(withFooter(footer)).success).toBe(true);
	});

	it('refuses a link with a bad URL', () => {
		const links = [{ ...LINK, url: 'data:text/html,x' }];
		expect(parseBrand(withFooter({ links })).success).toBe(false);
	});

	it.each(['red', '#fff', '#12345g', 'rgb(0,0,0)', '#1234567'])(
		'refuses the colour %s',
		(color) => {
			const colors = { ...DEFAULT_BRAND.colors, primary: color };
			expect(parseBrand({ ...DEFAULT_BRAND, colors }).success).toBe(false);
		},
	);

	it('refuses an empty name and a name over 100 characters', () => {
		expect(parseBrand({ ...DEFAULT_BRAND, name: '' }).success).toBe(false);
		expect(parseBrand({ ...DEFAULT_BRAND, name: 'x'.repeat(101) }).success).toBe(false);
	});

	it('accepts a wish font of letters, digits, spaces and hyphens', () => {
		const fonts = { ...DEFAULT_BRAND.fonts, headingWish: 'Open Sans-2 Ä' };
		expect(parseBrand({ ...DEFAULT_BRAND, fonts }).success).toBe(true);
	});

	it.each(['a"b', 'a;b', 'a,b', '', 'x'.repeat(61)])('refuses the wish font %j', (textWish) => {
		const fonts = { ...DEFAULT_BRAND.fonts, textWish };
		expect(parseBrand({ ...DEFAULT_BRAND, fonts }).success).toBe(false);
	});

	it('refuses an unknown font stack and unknown keys', () => {
		const fonts = { ...DEFAULT_BRAND.fonts, text: 'comic' };
		expect(parseBrand({ ...DEFAULT_BRAND, fonts }).success).toBe(false);
		expect(parseBrand({ ...DEFAULT_BRAND, extra: 1 }).success).toBe(false);
	});

	it('refuses a logo without a valid media id', () => {
		const logo = { alt: 'Logo', height: 10, mediaId: 'short', type: 'png', width: 10 };
		expect(parseBrand({ ...DEFAULT_BRAND, headerLogo: logo }).success).toBe(false);
		const good = { ...logo, mediaId: 'a'.repeat(22) };
		expect(parseBrand({ ...DEFAULT_BRAND, headerLogo: good }).success).toBe(true);
	});
});
