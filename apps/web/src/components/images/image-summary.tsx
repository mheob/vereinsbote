import type { ReactNode } from 'react';

import { useLocale, useT } from '@/i18n/use-t';
import { mediaPath } from '@/server/media/ids';
import type { LibraryImage } from '@/server/media/library';

import { formatBytes } from './image-size';

/** The border and focus ring of a library item (a row of the grid list). */
const imageItemClass =
	'flex flex-col gap-3 rounded-md border border-gray-600 bg-white p-3 outline-none data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-selected:border-2 data-selected:border-blue-700 data-selected:bg-blue-50';

/** The grid of the items: one column on a phone, up to three on a wide screen. */
const imageGridClass = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

/**
 * The words that say how often templates show an image.
 *
 * @param count The number of templates.
 * @returns The key of the text.
 */
function usageKey(count: number): 'images.usedMany' | 'images.usedNone' | 'images.usedOne' {
	if (count === 0) return 'images.usedNone';
	return count === 1 ? 'images.usedOne' : 'images.usedMany';
}

/**
 * What a library item shows: the thumbnail (its `alt` is the name), the name, the dimensions, the
 * size and in how many templates the image is used.
 *
 * @param props The props.
 * @param props.image The image.
 * @returns The summary.
 */
function ImageSummary({ image }: Readonly<{ image: Readonly<LibraryImage> }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	return (
		<div className="flex gap-3">
			<img
				alt={image.name}
				className="h-24 w-32 shrink-0 rounded-sm bg-gray-100 object-contain"
				height={image.height}
				loading="lazy"
				src={mediaPath(image.id, image.type)}
				width={image.width}
			/>
			<div className="flex min-w-0 flex-col gap-1">
				<span className="font-semibold wrap-break-word">{image.name}</span>
				<span className="text-sm text-gray-700">
					{`${t('images.dimensions', { height: image.height, width: image.width })}, ${formatBytes(image.bytes, locale)}`}
				</span>
				<span className="text-sm text-gray-700">
					{t(usageKey(image.usedBy.length), { count: image.usedBy.length })}
				</span>
			</div>
		</div>
	);
}

export { imageGridClass, ImageSummary, imageItemClass };
