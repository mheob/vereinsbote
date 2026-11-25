/*
 * The `brand.*` placeholder values of a brand (Design 7). Optional values that are empty are left
 * out, so the compiler treats a template that needs one as invalid.
 */
import { withoutTrailingSlashes } from '@/mail/trailing-slashes';
import { mediaPath } from '@/server/media/ids';

import type { Brand, BrandLogo } from './brand-schema';
import { fontFamilyCss } from './fonts';

function logoUrl(origin: string, logo: BrandLogo | null): string {
	return logo === null ? '' : `${origin}${mediaPath(logo.mediaId, logo.type)}`;
}

/**
 * The values of the brand placeholders.
 *
 * @param brand The brand.
 * @param appOrigin The origin of the app (`APP_URL`), for the absolute logo URLs.
 * @returns A map from placeholder key to value, without the empty optional ones.
 */
function brandPlaceholderValues(brand: Brand, appOrigin: string): Map<string, string> {
	const origin = withoutTrailingSlashes(appOrigin);
	const { colors, fonts, footer } = brand;
	const entries: [string, string | null][] = [
		['brand.name', brand.name],
		['brand.website', footer.websiteUrl],
		['brand.imprintUrl', footer.imprintUrl],
		['brand.privacyUrl', footer.privacyUrl],
		['brand.address', footer.address],
		['brand.register', footer.register],
		['brand.primaryColor', colors.primary],
		['brand.secondaryColor', colors.secondary],
		['brand.textColor', colors.text],
		['brand.backgroundColor', colors.background],
		['brand.linkColor', colors.link],
		['brand.fontFamily', fontFamilyCss(fonts.text, fonts.textWish)],
		['brand.headingFontFamily', fontFamilyCss(fonts.heading, fonts.headingWish)],
		['brand.logoUrl', logoUrl(origin, brand.headerLogo)],
		['brand.footerLogoUrl', logoUrl(origin, brand.footerLogo)],
	];
	const values = new Map<string, string>();
	for (const [key, value] of entries) {
		if (value !== null && value.trim() !== '') values.set(key, value);
	}
	return values;
}

export { brandPlaceholderValues };
