/*
 * The brand form's state and its way back to a `Brand`. Pure: the form keeps strings (what the
 * admin typed), `brandFromDraft` turns them into a brand with the same schema the server checks,
 * and names each refused field with the message to show at it.
 */
import type { MessageKey } from '@/i18n/translate';
import { brandSchema, MAX_FOOTER_LINKS } from '@/mail/brand/brand-schema';
import type { Brand, BrandLogo, FontStackId, IconVariant } from '@/mail/brand/brand-schema';
import { contrastFindings } from '@/mail/brand/contrast';
import type { ContrastFinding } from '@/mail/brand/contrast';
import { detectPlatform } from '@/mail/brand/social';

type ColorKey = keyof Brand['colors'];

interface LinkDraft {
	readonly url: string;
	readonly label: string;
	readonly display: 'text' | 'icon';
}

interface BrandDraft {
	readonly name: string;
	readonly headerLogo: BrandLogo | null;
	readonly footerLogo: BrandLogo | null;
	readonly logoAlign: Brand['logoAlign'];
	readonly colors: Brand['colors'];
	readonly fonts: {
		readonly text: FontStackId;
		readonly heading: FontStackId;
		readonly textWish: string;
		readonly headingWish: string;
	};
	readonly footer: {
		readonly address: string;
		readonly register: string;
		readonly imprintUrl: string;
		readonly privacyUrl: string;
		readonly websiteUrl: string;
		readonly text: string;
		readonly links: readonly LinkDraft[];
		readonly iconVariant: IconVariant;
	};
}

type LinkField = 'linkUrl' | 'linkLabel' | 'linkDisplay';

/** The fields that can be refused; a link's field carries its position (`linkUrl0`). */
type BrandDraftField =
	| 'name'
	| 'headerLogoAlt'
	| 'footerLogoAlt'
	| `${ColorKey}Color`
	| 'textWish'
	| 'headingWish'
	| 'address'
	| 'register'
	| 'imprintUrl'
	| 'privacyUrl'
	| 'websiteUrl'
	| 'footerText'
	| 'links'
	| `${LinkField}${number}`;

type BrandDraftErrors = Partial<Record<BrandDraftField, MessageKey>>;

type BrandFromDraft =
	| { readonly ok: true; readonly brand: Brand }
	| { readonly ok: false; readonly errors: BrandDraftErrors };

const LETTER = /\p{L}/u;

/**
 * The form state of a brand.
 *
 * @param brand The brand.
 * @returns The draft; empty optional values are empty strings.
 */
function draftFromBrand(brand: Brand): BrandDraft {
	const { footer, fonts } = brand;
	return {
		colors: { ...brand.colors },
		fonts: {
			heading: fonts.heading,
			headingWish: fonts.headingWish ?? '',
			text: fonts.text,
			textWish: fonts.textWish ?? '',
		},
		footer: {
			address: footer.address,
			iconVariant: footer.iconVariant,
			imprintUrl: footer.imprintUrl ?? '',
			links: footer.links.map(({ display, label, url }) => ({ display, label, url })),
			privacyUrl: footer.privacyUrl ?? '',
			register: footer.register,
			text: footer.text,
			websiteUrl: footer.websiteUrl ?? '',
		},
		footerLogo: brand.footerLogo,
		headerLogo: brand.headerLogo,
		logoAlign: brand.logoAlign,
		name: brand.name,
	};
}

function orNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function candidate(draft: Readonly<BrandDraft>): unknown {
	const { footer, fonts } = draft;
	return {
		colors: draft.colors,
		fonts: {
			heading: fonts.heading,
			headingWish: orNull(fonts.headingWish),
			text: fonts.text,
			textWish: orNull(fonts.textWish),
		},
		footer: {
			address: footer.address,
			iconVariant: footer.iconVariant,
			imprintUrl: orNull(footer.imprintUrl),
			links: footer.links.map(({ display, label, url }) => ({
				display,
				label: label.trim(),
				url: url.trim(),
			})),
			privacyUrl: orNull(footer.privacyUrl),
			register: footer.register,
			text: footer.text,
			websiteUrl: orNull(footer.websiteUrl),
		},
		footerLogo: draft.footerLogo,
		headerLogo: draft.headerLogo,
		logoAlign: draft.logoAlign,
		name: draft.name,
	};
}

/**
 * The wish fonts that have no letter; the schema only checks the characters.
 *
 * @param fonts The fonts of the draft.
 * @returns The refused fields.
 */
function wishFontErrors(fonts: BrandDraft['fonts']): BrandDraftErrors {
	const errors: BrandDraftErrors = {};
	if (fonts.textWish.trim() !== '' && !LETTER.test(fonts.textWish)) {
		errors.textWish = 'brand.wishFontInvalid';
	}
	if (fonts.headingWish.trim() !== '' && !LETTER.test(fonts.headingWish)) {
		errors.headingWish = 'brand.wishFontInvalid';
	}
	return errors;
}

/**
 * The links the schema accepts but the footer cannot show: a text link without text and an icon
 * for an address that names no platform.
 *
 * @param links The links of the draft.
 * @returns The refused fields, by the position of the link.
 */
function linkErrors(links: readonly LinkDraft[]): BrandDraftErrors {
	const errors: BrandDraftErrors = {};
	if (links.length > MAX_FOOTER_LINKS) errors.links = 'brand.tooManyLinks';
	for (const [index, link] of links.entries()) {
		if (link.display === 'text' && link.label.trim() === '') {
			errors[`linkLabel${index}`] = 'brand.linkLabelInvalid';
		}
		if (link.display === 'icon' && detectPlatform(link.url.trim()) === null) {
			errors[`linkDisplay${index}`] = 'brand.linkIconUnknown';
		}
	}
	return errors;
}

const FOOTER_FIELDS: Readonly<Record<string, BrandDraftField>> = {
	address: 'address',
	imprintUrl: 'imprintUrl',
	privacyUrl: 'privacyUrl',
	register: 'register',
	text: 'footerText',
	websiteUrl: 'websiteUrl',
};

const LINK_FIELDS: Readonly<Record<string, LinkField>> = {
	display: 'linkDisplay',
	label: 'linkLabel',
	url: 'linkUrl',
};

const COLOR_KEYS: readonly ColorKey[] = ['primary', 'secondary', 'text', 'background', 'link'];

const LINK_PATH_LENGTH = 4;

function isColorKey(value: unknown): value is ColorKey {
	return COLOR_KEYS.some((key) => key === value);
}

function linkFieldOf(path: readonly PropertyKey[]): BrandDraftField {
	const index = path[2];
	const key = path[3];
	if (typeof index !== 'number' || typeof key !== 'string') return 'links';
	return `${LINK_FIELDS[key] ?? 'linkUrl'}${index}`;
}

function fieldOf(path: readonly PropertyKey[]): BrandDraftField {
	const [first, second] = path;
	if (first === 'headerLogo') return 'headerLogoAlt';
	if (first === 'footerLogo') return 'footerLogoAlt';
	if (first === 'colors' && isColorKey(second)) return `${second}Color`;
	if (first === 'fonts') return second === 'headingWish' ? 'headingWish' : 'textWish';
	if (first === 'footer') {
		if (second === 'links') return path.length >= LINK_PATH_LENGTH ? linkFieldOf(path) : 'links';
		return (typeof second === 'string' ? FOOTER_FIELDS[second] : undefined) ?? 'address';
	}
	return 'name';
}

function messageFor(field: BrandDraftField): MessageKey {
	if (field === 'name') return 'brand.nameInvalid';
	if (field === 'headerLogoAlt' || field === 'footerLogoAlt') return 'brand.altTooLong';
	if (field.endsWith('Color')) return 'brand.colorInvalid';
	if (field === 'textWish' || field === 'headingWish') return 'brand.wishFontInvalid';
	if (field.endsWith('Url') || field.startsWith('linkUrl')) return 'brand.urlInvalid';
	if (field === 'links') return 'brand.tooManyLinks';
	if (field.startsWith('linkLabel')) return 'brand.linkLabelInvalid';
	if (field.startsWith('linkDisplay')) return 'brand.linkIconUnknown';
	return 'brand.textTooLong';
}

/**
 * The brand of a draft, checked with the schema the server uses. Empty optional values become
 * null, texts are trimmed where the schema trims.
 *
 * @param draft The form state.
 * @returns The brand, or the message for each refused field.
 */
function brandFromDraft(draft: Readonly<BrandDraft>): BrandFromDraft {
	const errors = { ...wishFontErrors(draft.fonts), ...linkErrors(draft.footer.links) };
	const parsed = brandSchema.safeParse(candidate(draft));
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const field = fieldOf(issue.path);
			errors[field] ??= messageFor(field);
		}
	}
	if (Object.keys(errors).length > 0 || !parsed.success) return { errors, ok: false };
	return { brand: parsed.data, ok: true };
}

/**
 * Whether the page recommends the imprint and privacy links: while one of them is empty.
 *
 * @param draft The form state.
 * @returns True when the imprint or the privacy address is empty.
 */
function recommendsLegalLinks(draft: Readonly<BrandDraft>): boolean {
	return draft.footer.imprintUrl.trim() === '' || draft.footer.privacyUrl.trim() === '';
}

/** A change of the draft, applied to the latest one (an upload may finish while the admin types). */
type DraftUpdate = (draft: Readonly<BrandDraft>) => BrandDraft;

/**
 * The update that changes top-level fields (name, logos, alignment).
 *
 * @param patch The new values.
 * @returns The update.
 */
function updateDraft(patch: Readonly<Partial<BrandDraft>>): DraftUpdate {
	return (draft) => ({ ...draft, ...patch });
}

/**
 * The update that sets one colour.
 *
 * @param key The colour.
 * @param value The new `#rrggbb` value.
 * @returns The update.
 */
function updateColor(key: ColorKey, value: string): DraftUpdate {
	return (draft) => ({ ...draft, colors: { ...draft.colors, [key]: value } });
}

/**
 * The update that changes fonts.
 *
 * @param patch The new values.
 * @returns The update.
 */
function updateFonts(patch: Readonly<Partial<BrandDraft['fonts']>>): DraftUpdate {
	return (draft) => ({ ...draft, fonts: { ...draft.fonts, ...patch } });
}

/**
 * The update that changes footer fields.
 *
 * @param patch The new values.
 * @returns The update.
 */
function updateFooter(patch: Readonly<Partial<BrandDraft['footer']>>): DraftUpdate {
	return (draft) => ({ ...draft, footer: { ...draft.footer, ...patch } });
}

/** The footer's single-value text fields. */
type FooterTextField = 'address' | 'register' | 'imprintUrl' | 'privacyUrl' | 'websiteUrl' | 'text';

/**
 * The update that sets one of the footer's text fields.
 *
 * @param field The field.
 * @param value The new text.
 * @returns The update.
 */
function updateFooterText(field: FooterTextField, value: string): DraftUpdate {
	return (draft) => ({ ...draft, footer: { ...draft.footer, [field]: value } });
}

/** The colour whose field carries the warning of a weak pair. */
const PAIR_FIELD: Readonly<Record<ContrastFinding['pair'], ColorKey>> = {
	buttonText: 'primary',
	footerText: 'secondary',
	linkOnBackground: 'link',
	textOnBackground: 'text',
};

/**
 * The weak colour pairs, by the colour whose field shows the warning (Design 7).
 *
 * @param colors The colours.
 * @returns The ratio per colour; a colour without a weak pair is missing.
 */
function weakRatios(colors: Readonly<Brand['colors']>): Partial<Record<ColorKey, number>> {
	return Object.fromEntries(
		contrastFindings(colors).map(({ pair, ratio }) => [PAIR_FIELD[pair], ratio]),
	);
}

export {
	brandFromDraft,
	COLOR_KEYS,
	draftFromBrand,
	recommendsLegalLinks,
	updateColor,
	updateDraft,
	updateFonts,
	updateFooter,
	updateFooterText,
	weakRatios,
};
export type {
	BrandDraft,
	BrandDraftErrors,
	BrandDraftField,
	ColorKey,
	DraftUpdate,
	FooterTextField,
	LinkDraft,
};
