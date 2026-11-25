import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';

import { formatBytes } from './image-size';

/**
 * What the upload field announces after a successful upload: the sizes before and after the
 * scaling, that an animated GIF became a still image, and the upload itself. Each part is a
 * sentence of its own with its period, joined by spaces.
 *
 * @param locale The language.
 * @param result What the processing gave.
 * @param result.before The size of the chosen file, in bytes.
 * @param result.after The size of the uploaded image, in bytes.
 * @param result.flattenedGif Whether an animated GIF was flattened to its first frame.
 * @returns The announcement.
 */
function uploadedMessage(
	locale: Locale,
	result: Readonly<{ before: number; after: number; flattenedGif: boolean }>,
): string {
	const sentences = [
		translate(locale, 'imageUpload.resized', {
			after: formatBytes(result.after, locale),
			before: formatBytes(result.before, locale),
		}),
		...(result.flattenedGif ? [translate(locale, 'imageUpload.flattenedGif')] : []),
		translate(locale, 'imageUpload.uploaded'),
	];
	return sentences.join(' ');
}

export { uploadedMessage };
