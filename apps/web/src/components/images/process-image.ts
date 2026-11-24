import { MAX_IMAGE_BYTES, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH } from '@/server/media/limits';

import { browserImageDeps } from './browser-image';
import { JPEG_QUALITY, chooseOutputType, fitWidth } from './image-size';

type OutputType = 'image/jpeg' | 'image/png';

/** A decoded image, as the browser (or a test) hands it over. */
interface DecodedImage {
	/** Size after the EXIF rotation. */
	readonly width: number;
	readonly height: number;
	readonly hasAlpha: boolean;
	/** A GIF: only its first frame is kept. */
	readonly animated: boolean;
	readonly isSvg: boolean;
	/** Draws the image at the given size and encodes it; the result carries no metadata. */
	// oxlint-disable-next-line max-params -- the four arguments are the contract with the browser glue
	readonly encode: (
		type: OutputType,
		quality: number,
		width: number,
		height: number,
	) => Promise<Blob>;
}

/** What `processImage` needs from the browser; tests pass fakes. */
interface ImageDeps {
	/** Decodes the file, or gives null when it is no image the browser can read. */
	readonly decode: (file: Blob) => Promise<DecodedImage | null>;
}

type ProcessFailure = 'unreadable' | 'svgNotAllowed' | 'tooTall' | 'tooLarge';

type ProcessResult =
	| {
			ok: true;
			blob: Blob;
			name: string;
			width: number;
			height: number;
			before: number;
			after: number;
			flattenedGif: boolean;
	  }
	| { ok: false; reason: ProcessFailure };

/**
 * The file name with its extension replaced by the one of the new format.
 *
 * @param name The name of the chosen file.
 * @param type The format of the new image.
 * @returns The name to upload under.
 */
function outputName(name: string, type: OutputType): string {
	const parts = name.split('.');
	if (parts.length > 1) parts.pop();
	const base = parts.join('.');
	return `${base.trim() === '' ? 'image' : base}${type === 'image/png' ? '.png' : '.jpg'}`;
}

/**
 * Decodes with the decoder; a thrown error is no image either.
 *
 * @param deps The decoder.
 * @param file The chosen file.
 * @returns The decoded image, or null.
 */
async function tryDecode(deps: ImageDeps, file: File): Promise<DecodedImage | null> {
	try {
		return await deps.decode(file);
	} catch {
		return null;
	}
}

/**
 * Why a decoded image cannot be used, before it is encoded.
 *
 * @param image The decoded image.
 * @param check What to check it against.
 * @param check.allowSvg Whether an SVG is accepted.
 * @param check.height The height after scaling to the maximum width.
 * @returns The reason, or null when the image is fine.
 */
function refusalFor(
	image: DecodedImage,
	check: Readonly<{ allowSvg: boolean; height: number }>,
): ProcessFailure | null {
	if (image.width < 1 || image.height < 1) return 'unreadable';
	if (image.isSvg && !check.allowSvg) return 'svgNotAllowed';
	return check.height > MAX_IMAGE_HEIGHT ? 'tooTall' : null;
}

/**
 * Encodes the image; a failing canvas is no image either.
 *
 * @param image The decoded image.
 * @param type The format.
 * @param size The size to draw at.
 * @param size.width Width in pixels.
 * @param size.height Height in pixels.
 * @returns The encoded image, or null.
 */
async function tryEncode(
	image: DecodedImage,
	type: OutputType,
	size: Readonly<{ width: number; height: number }>,
): Promise<Blob | null> {
	try {
		return await image.encode(type, JPEG_QUALITY, size.width, size.height);
	} catch {
		return null;
	}
}

/**
 * Prepares an image for upload: decodes it with its EXIF rotation, scales it to at most 1200 px
 * wide and encodes it anew, which drops all metadata. JPEG, or PNG when it is transparent.
 *
 * @param file The chosen file.
 * @param options What is accepted.
 * @param options.allowSvg Accept SVG (the brand's logo).
 * @param deps The decoder; the browser's by default.
 * @returns The image to upload, or why it cannot be.
 */
async function processImage(
	file: File,
	options: Readonly<{ allowSvg: boolean }>,
	deps: ImageDeps = browserImageDeps,
): Promise<ProcessResult> {
	const image = await tryDecode(deps, file);
	if (image === null) return { ok: false, reason: 'unreadable' };
	const { height, width } = fitWidth(image, MAX_IMAGE_WIDTH);
	const reason = refusalFor(image, { allowSvg: options.allowSvg, height });
	if (reason !== null) return { ok: false, reason };
	const type = chooseOutputType(image.hasAlpha);
	const blob = await tryEncode(image, type, { height, width });
	if (blob === null) return { ok: false, reason: 'unreadable' };
	if (blob.size > MAX_IMAGE_BYTES) return { ok: false, reason: 'tooLarge' };
	return {
		after: blob.size,
		before: file.size,
		blob,
		flattenedGif: image.animated,
		height,
		name: outputName(file.name, type),
		ok: true,
		width,
	};
}

export { processImage };
export type { DecodedImage, ImageDeps, OutputType, ProcessFailure, ProcessResult };
