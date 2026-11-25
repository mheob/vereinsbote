import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_BRAND, MAX_FOOTER_LINKS } from '@/mail/brand/brand-schema';
import type { BrandLogo } from '@/mail/brand/brand-schema';

import {
	brandFromDraft,
	contrastAnnouncement,
	contrastWarnings,
	contrastWarningText,
	draftFromBrand,
	recommendsLegalLinks,
	updateColor,
	updateDraft,
	updateFonts,
	updateFooter,
} from './brand-draft';
import type { BrandDraft } from './brand-draft';

const LOGO: BrandLogo = {
	alt: 'Wappen',
	height: 100,
	mediaId: 'AAAAAAAAAAAAAAAAAAAAAA',
	type: 'png',
	width: 200,
};

/**
 * A draft that is valid, with changes.
 *
 * @param change What differs from the default brand's draft.
 * @returns The draft.
 */
function draft(change: Partial<BrandDraft> = {}): BrandDraft {
	return { ...draftFromBrand(DEFAULT_BRAND), ...change };
}

/**
 * A draft with a footer change.
 *
 * @param footer What differs in the footer.
 * @returns The draft.
 */
function withFooter(footer: Partial<BrandDraft['footer']>): BrandDraft {
	const base = draftFromBrand(DEFAULT_BRAND);
	return { ...base, footer: { ...base.footer, ...footer } };
}

/**
 * A draft whose one link is shown as an icon.
 *
 * @param url The address of the link.
 * @returns The draft.
 */
function withIconLink(url: string): BrandDraft {
	return withFooter({ links: [{ display: 'icon', label: '', url }] });
}

describe(brandFromDraft, () => {
	it('accepts a valid draft', () => {
		const result = brandFromDraft(draft({ headerLogo: LOGO, name: ' Sportverein ' }));
		expect(result).toStrictEqual({
			brand: { ...DEFAULT_BRAND, headerLogo: LOGO, name: 'Sportverein' },
			ok: true,
		});
	});

	it('turns empty optional values into null', () => {
		const result = brandFromDraft(withFooter({ imprintUrl: '', websiteUrl: '  ' }));
		expect(result).toStrictEqual({ brand: DEFAULT_BRAND, ok: true });
	});

	it('refuses an empty name', () => {
		const result = brandFromDraft(draft({ name: '  ' }));
		expect(result).toStrictEqual({ errors: { name: 'brand.nameInvalid' }, ok: false });
	});

	it('refuses an address that is no https or mailto link', () => {
		const result = brandFromDraft(withFooter({ imprintUrl: 'http://example.org/impressum' }));
		expect(result).toStrictEqual({ errors: { imprintUrl: 'brand.urlInvalid' }, ok: false });
	});

	it('refuses a colour that is no hex value', () => {
		const base = draftFromBrand(DEFAULT_BRAND);
		const result = brandFromDraft({ ...base, colors: { ...base.colors, text: 'red' } });
		expect(result).toStrictEqual({ errors: { textColor: 'brand.colorInvalid' }, ok: false });
	});

	it('refuses a wish font without a letter or with other characters', () => {
		const base = draftFromBrand(DEFAULT_BRAND);
		const digits = brandFromDraft({ ...base, fonts: { ...base.fonts, textWish: '123' } });
		expect(digits).toStrictEqual({ errors: { textWish: 'brand.wishFontInvalid' }, ok: false });
		const quote = brandFromDraft({ ...base, fonts: { ...base.fonts, headingWish: 'Open";Sans' } });
		expect(quote).toStrictEqual({ errors: { headingWish: 'brand.wishFontInvalid' }, ok: false });
	});

	it('accepts a wish font and keeps empty ones as null', () => {
		const base = draftFromBrand(DEFAULT_BRAND);
		const result = brandFromDraft({ ...base, fonts: { ...base.fonts, textWish: 'Open Sans' } });
		expect(result).toMatchObject({
			brand: { fonts: { headingWish: null, textWish: 'Open Sans' } },
		});
	});

	it('allows five links and no sixth', () => {
		const link = { display: 'text', label: 'Seite', url: 'https://example.org/' } as const;
		const five = brandFromDraft(
			withFooter({ links: Array.from({ length: MAX_FOOTER_LINKS }, () => link) }),
		);
		expect(five.ok).toBe(true);
		const six = brandFromDraft(
			withFooter({ links: Array.from({ length: MAX_FOOTER_LINKS + 1 }, () => link) }),
		);
		expect(six).toStrictEqual({ errors: { links: 'brand.tooManyLinks' }, ok: false });
	});

	it('names the link that is wrong', () => {
		const result = brandFromDraft(
			withFooter({
				links: [
					{ display: 'text', label: 'Gut', url: 'https://example.org/' },
					{ display: 'text', label: '', url: 'ftp://example.org/' },
				],
			}),
		);
		expect(result).toStrictEqual({
			errors: { linkLabel1: 'brand.linkLabelInvalid', linkUrl1: 'brand.urlInvalid' },
			ok: false,
		});
	});

	it('shows an icon only for a recognised platform', () => {
		expect(brandFromDraft(withIconLink('https://www.instagram.com/verein')).ok).toBe(true);
		expect(brandFromDraft(withIconLink('https://example.org/'))).toStrictEqual({
			errors: { linkDisplay0: 'brand.linkIconUnknown' },
			ok: false,
		});
	});

	it('refuses a logo text that is too long', () => {
		const result = brandFromDraft(draft({ headerLogo: { ...LOGO, alt: 'x'.repeat(201) } }));
		expect(result).toStrictEqual({ errors: { headerLogoAlt: 'brand.altTooLong' }, ok: false });
	});
});

describe(draftFromBrand, () => {
	it('round-trips a brand', () => {
		const brand = {
			...DEFAULT_BRAND,
			fonts: { ...DEFAULT_BRAND.fonts, textWish: 'Lato' },
			footer: { ...DEFAULT_BRAND.footer, imprintUrl: 'https://example.org/impressum' },
			footerLogo: LOGO,
		};
		expect(brandFromDraft(draftFromBrand(brand))).toStrictEqual({ brand, ok: true });
	});
});

describe(recommendsLegalLinks, () => {
	it('recommends them while the imprint or the privacy link is empty', () => {
		expect(recommendsLegalLinks(withFooter({}))).toBe(true);
		expect(recommendsLegalLinks(withFooter({ imprintUrl: 'https://example.org/i' }))).toBe(true);
		expect(
			recommendsLegalLinks(
				withFooter({ imprintUrl: 'https://example.org/i', privacyUrl: 'https://example.org/p' }),
			),
		).toBe(false);
	});
});

describe('the updates', () => {
	it('change one part and keep the rest', () => {
		const base = draftFromBrand(DEFAULT_BRAND);
		expect(updateDraft({ name: 'Neu' })(base)).toStrictEqual({ ...base, name: 'Neu' });
		expect(updateColor('text', '#000000')(base).colors).toStrictEqual({
			...base.colors,
			text: '#000000',
		});
		expect(updateFonts({ textWish: 'Lato' })(base).fonts).toStrictEqual({
			...base.fonts,
			textWish: 'Lato',
		});
		expect(updateFooter({ address: 'Weg 1' })(base).footer).toStrictEqual({
			...base.footer,
			address: 'Weg 1',
		});
	});

	it('leave the draft they were applied to unchanged', () => {
		const base = draftFromBrand(DEFAULT_BRAND);
		updateColor('text', '#000000')(base);
		expect(base.colors.text).toBe(DEFAULT_BRAND.colors.text);
	});
});

const GREY_TEXT = { ...DEFAULT_BRAND.colors, text: '#777777' };

describe(contrastWarnings, () => {
	it('has nothing to say about the default colours', () => {
		expect(contrastWarnings(DEFAULT_BRAND.colors)).toStrictEqual({});
	});

	it('warns at both fields of a weak pair', () => {
		const warnings = contrastWarnings(GREY_TEXT);
		expect(Object.keys(warnings).toSorted()).toStrictEqual(['background', 'text']);
		expect(warnings.text).toStrictEqual(warnings.background);
		expect(warnings.text?.map(({ pair }) => pair)).toStrictEqual(['textOnBackground']);
		expect(warnings.text?.[0]?.ratio).toBeCloseTo(4.48, 1);
	});

	it('names both pairs at the background when it weakens text and links', () => {
		const warnings = contrastWarnings({ ...DEFAULT_BRAND.colors, background: '#555555' });
		expect(warnings.background?.map(({ pair }) => pair)).toStrictEqual([
			'textOnBackground',
			'linkOnBackground',
		]);
		expect(warnings.text?.map(({ pair }) => pair)).toStrictEqual(['textOnBackground']);
		expect(warnings.link?.map(({ pair }) => pair)).toStrictEqual(['linkOnBackground']);
	});

	it('never flags the primary and secondary colour: their text is black or white', () => {
		const grey = { ...DEFAULT_BRAND.colors, primary: '#777777', secondary: '#777777' };
		expect(contrastWarnings(grey)).toStrictEqual({});
	});
});

describe(contrastWarningText, () => {
	it('names the pair and the ratio, cut to two digits, in the language', () => {
		const finding = { pair: 'textOnBackground', ratio: 4.4999 } as const;
		expect(contrastWarningText('de', finding)).toBe(
			'Text auf Hintergrund: Kontrast 4,49:1, empfohlen mindestens 4,5:1.',
		);
		expect(contrastWarningText('en', finding)).toBe(
			'Text on background: contrast 4.49:1, at least 4.5:1 recommended.',
		);
	});

	it('has a name for every pair', () => {
		expect(contrastWarningText('de', { pair: 'linkOnBackground', ratio: 3 })).toMatch(
			/^Links auf Hintergrund: /u,
		);
		expect(contrastWarningText('de', { pair: 'buttonText', ratio: 3 })).toMatch(
			/^Buttonschrift auf Primärfarbe: /u,
		);
		expect(contrastWarningText('de', { pair: 'footerText', ratio: 3 })).toMatch(
			/^Fußzeilenschrift auf Sekundärfarbe: /u,
		);
	});
});

describe(contrastAnnouncement, () => {
	it('says nothing while the weak pairs stay as they are', () => {
		expect(contrastAnnouncement('de', DEFAULT_BRAND.colors, DEFAULT_BRAND.colors)).toBeNull();
		expect(
			contrastAnnouncement('de', DEFAULT_BRAND.colors, {
				...DEFAULT_BRAND.colors,
				primary: '#123456',
			}),
		).toBeNull();
	});

	it('announces a pair that became weak, with its ratio', () => {
		expect(contrastAnnouncement('de', DEFAULT_BRAND.colors, GREY_TEXT)).toMatch(
			/^Text auf Hintergrund: Kontrast 4,4\d:1, empfohlen mindestens 4,5:1\.$/u,
		);
	});

	it('announces a new ratio of a pair that stays weak, but not a change it does not show', () => {
		const greyer = { ...GREY_TEXT, text: '#888888' };
		expect(contrastAnnouncement('de', GREY_TEXT, greyer)).toMatch(
			/^Text auf Hintergrund: Kontrast 3,5\d:1/u,
		);
		expect(contrastAnnouncement('de', GREY_TEXT, { ...GREY_TEXT, text: '#777778' })).toBeNull();
	});

	it('announces a pair that reads well again', () => {
		expect(contrastAnnouncement('en', GREY_TEXT, DEFAULT_BRAND.colors)).toBe(
			'Text on background: contrast now sufficient.',
		);
	});

	it('names every changed pair of one change, in the order of the layout', () => {
		const dark = { ...DEFAULT_BRAND.colors, background: '#555555' };
		expect(contrastAnnouncement('de', DEFAULT_BRAND.colors, dark)).toMatch(
			/^Text auf Hintergrund: .+\. Links auf Hintergrund: .+\.$/u,
		);
		expect(contrastAnnouncement('de', dark, DEFAULT_BRAND.colors)).toBe(
			'Text auf Hintergrund: Kontrast jetzt ausreichend. Links auf Hintergrund: Kontrast jetzt ausreichend.',
		);
	});
});
