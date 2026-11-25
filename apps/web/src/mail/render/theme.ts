/*
 * The colours and fonts of the brand as the mail components use them in inline styles.
 */
import type { Brand } from '@/mail/brand/brand-schema';
import { readableTextOn } from '@/mail/brand/contrast';
import { fontFamilyCss } from '@/mail/brand/fonts';

interface MailTheme {
	readonly text: string;
	/** The content area. */
	readonly background: string;
	readonly link: string;
	/** Buttons and the accent line of the header. */
	readonly primary: string;
	/** Black or white, whichever reads better on the primary colour. */
	readonly buttonText: string;
	/** The page around the content area, and the footer. */
	readonly secondary: string;
	/** Black or white, whichever reads better on the secondary colour. */
	readonly footerText: string;
	readonly font: string;
	readonly headingFont: string;
}

/**
 * The theme of a brand.
 *
 * @param brand The brand.
 * @returns Colours and `font-family` values.
 */
function mailTheme(brand: Brand): MailTheme {
	const { colors, fonts } = brand;
	return {
		background: colors.background,
		buttonText: readableTextOn(colors.primary),
		font: fontFamilyCss(fonts.text, fonts.textWish),
		footerText: readableTextOn(colors.secondary),
		headingFont: fontFamilyCss(fonts.heading, fonts.headingWish),
		link: colors.link,
		primary: colors.primary,
		secondary: colors.secondary,
		text: colors.text,
	};
}

export { mailTheme };
export type { MailTheme };
