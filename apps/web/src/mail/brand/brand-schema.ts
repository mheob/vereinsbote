/*
 * The corporate design (CD) of the club and its validation. No server imports: the admin form in
 * the browser and the server check the same schema, and mails are rendered from it on every
 * platform.
 */
import { z } from 'zod';

import type { ImageType } from '@/server/media/ids';

const FONT_STACKS = ['arial', 'verdana', 'tahoma', 'trebuchet', 'georgia', 'times'] as const;
type FontStackId = (typeof FONT_STACKS)[number];

/** The platforms the icon set knows (`public/social`); LinkedIn is not in `simple-icons` any more. */
const SOCIAL_PLATFORMS = [
	'instagram',
	'facebook',
	'youtube',
	'tiktok',
	'mastodon',
	'bluesky',
	'threads',
	'x',
	'whatsapp',
] as const;
type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const ICON_VARIANTS = ['dark', 'light', 'brand'] as const;
type IconVariant = (typeof ICON_VARIANTS)[number];

interface BrandLogo {
	readonly mediaId: string;
	readonly type: ImageType;
	readonly width: number;
	readonly height: number;
	readonly alt: string;
}

interface FooterLink {
	readonly url: string;
	readonly label: string;
	readonly display: 'text' | 'icon';
}

interface Brand {
	readonly name: string;
	readonly headerLogo: BrandLogo | null;
	readonly footerLogo: BrandLogo | null;
	readonly logoAlign: 'left' | 'center';
	/** Each a `#rrggbb` value. */
	readonly colors: {
		readonly primary: string;
		readonly secondary: string;
		readonly text: string;
		readonly background: string;
		readonly link: string;
	};
	readonly fonts: {
		readonly text: FontStackId;
		readonly heading: FontStackId;
		/** A font the recipient may have installed, put before the stack; never loaded. */
		readonly textWish: string | null;
		readonly headingWish: string | null;
	};
	readonly footer: {
		readonly address: string;
		readonly register: string;
		readonly imprintUrl: string | null;
		readonly privacyUrl: string | null;
		readonly websiteUrl: string | null;
		readonly text: string;
		/** At most `MAX_FOOTER_LINKS`. */
		readonly links: readonly FooterLink[];
		readonly iconVariant: IconVariant;
	};
}

const MAX_FOOTER_LINKS = 5;
const MAX_NAME_LENGTH = 100;
const MAX_LABEL_LENGTH = 60;
const MAX_URL_LENGTH = 500;
const MAX_ALT_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 300;
const MAX_REGISTER_LENGTH = 200;
const MAX_FOOTER_TEXT_LENGTH = 1000;
const MEDIA_ID_LENGTH = 22;

const HEX_COLOR = /^#[\da-f]{6}$/iu;
/** Letters, digits, spaces and hyphens: nothing that can leave a quoted CSS font name. */
const WISH_FONT = /^[\p{L}\p{N} -]{1,60}$/u;
const MEDIA_ID = /^[\w-]{22}$/u;

function isLinkUrl(value: string): boolean {
	const protocol = URL.canParse(value) ? new URL(value).protocol : '';
	return protocol === 'https:' || protocol === 'mailto:';
}

const color = z.string().regex(HEX_COLOR);
const linkUrl = z.string().max(MAX_URL_LENGTH).refine(isLinkUrl);
const optionalUrl = linkUrl.nullable();
const wishFont = z.string().regex(WISH_FONT).nullable();
const fontStack = z.enum(FONT_STACKS);

const logo = z.strictObject({
	alt: z.string().max(MAX_ALT_LENGTH),
	height: z.int().positive(),
	mediaId: z.string().length(MEDIA_ID_LENGTH).regex(MEDIA_ID),
	type: z.enum(['jpeg', 'png']),
	width: z.int().positive(),
});

const footerLink = z.strictObject({
	display: z.enum(['text', 'icon']),
	label: z.string().max(MAX_LABEL_LENGTH),
	url: linkUrl,
});

const colors = z.strictObject({
	background: color,
	link: color,
	primary: color,
	secondary: color,
	text: color,
});

const fonts = z.strictObject({
	heading: fontStack,
	headingWish: wishFont,
	text: fontStack,
	textWish: wishFont,
});

const footer = z.strictObject({
	address: z.string().max(MAX_ADDRESS_LENGTH),
	iconVariant: z.enum(ICON_VARIANTS),
	imprintUrl: optionalUrl,
	links: z.array(footerLink).max(MAX_FOOTER_LINKS),
	privacyUrl: optionalUrl,
	register: z.string().max(MAX_REGISTER_LENGTH),
	text: z.string().max(MAX_FOOTER_TEXT_LENGTH),
	websiteUrl: optionalUrl,
});

const brandSchema: z.ZodType<Brand> = z.strictObject({
	colors,
	fonts,
	footer,
	footerLogo: logo.nullable(),
	headerLogo: logo.nullable(),
	logoAlign: z.enum(['left', 'center']),
	name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});

/** The neutral brand that applies until an admin saves one (Design 7). */
const DEFAULT_BRAND: Brand = {
	colors: {
		background: '#ffffff',
		link: '#1d4ed8',
		primary: '#1d4ed8',
		secondary: '#f3f4f6',
		text: '#1f2937',
	},
	fonts: { heading: 'arial', headingWish: null, text: 'arial', textWish: null },
	footer: {
		address: '',
		iconVariant: 'dark',
		imprintUrl: null,
		links: [],
		privacyUrl: null,
		register: '',
		text: '',
		websiteUrl: null,
	},
	footerLogo: null,
	headerLogo: null,
	logoAlign: 'left',
	name: 'Verein',
};

export {
	brandSchema,
	DEFAULT_BRAND,
	FONT_STACKS,
	ICON_VARIANTS,
	MAX_FOOTER_LINKS,
	SOCIAL_PLATFORMS,
};
export type { Brand, BrandLogo, FontStackId, FooterLink, IconVariant, SocialPlatform };
