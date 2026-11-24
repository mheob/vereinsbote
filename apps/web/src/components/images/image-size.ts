import type { Locale } from '@/i18n/locale';

/** The quality of a re-encoded JPEG. */
const JPEG_QUALITY = 0.85;

const KIBIBYTE = 1024;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;

/**
 * Scales an image down to a maximum width and keeps its proportions. A narrower image stays as
 * it is: nothing is enlarged.
 *
 * @param size The size of the image in pixels.
 * @param maxWidth The widest the result may be.
 * @returns The size to draw at; the height is at least 1.
 */
function fitWidth(
	size: Readonly<{ width: number; height: number }>,
	maxWidth: number,
): { width: number; height: number } {
	if (size.width <= maxWidth) return { height: size.height, width: size.width };
	return {
		height: Math.max(1, Math.round((size.height * maxWidth) / size.width)),
		width: maxWidth,
	};
}

/**
 * Chooses the format of the re-encoded image: PNG keeps transparency, JPEG is smaller for photos.
 *
 * @param hasAlpha Whether the image has transparent pixels.
 * @returns The MIME type to encode.
 */
function chooseOutputType(hasAlpha: boolean): 'image/jpeg' | 'image/png' {
	return hasAlpha ? 'image/png' : 'image/jpeg';
}

/**
 * Writes a file size for people: bytes, KB or MB with at most one decimal.
 *
 * @param bytes The size in bytes.
 * @param locale The language of the number.
 * @returns For example `20,5 MB`.
 */
function formatBytes(bytes: number, locale: Locale): string {
	const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
	if (bytes < KIBIBYTE) return `${number.format(bytes)} B`;
	if (bytes < MEBIBYTE) return `${number.format(bytes / KIBIBYTE)} KB`;
	return `${number.format(bytes / MEBIBYTE)} MB`;
}

export { JPEG_QUALITY, chooseOutputType, fitWidth, formatBytes };
