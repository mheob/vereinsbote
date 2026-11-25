import { fitWidth, svgRasterSize } from './image-size';
import type { DecodedImage, ImageDeps, OutputType } from './process-image';

/* oxlint-disable typescript/prefer-readonly-parameter-types -- DOM objects (canvas, bitmap, image) are mutable handles by design */

/*
 * The browser's side of the image processing: decoding and drawing. It is thin on purpose;
 * everything that decides something is in `process-image.ts` and tested with fakes. Nothing
 * here runs at import time. No workers, no `eval`: the CSP forbids both.
 */

/** Width of the small copy that is searched for transparent pixels. */
const PROBE_WIDTH = 256;
/** The alpha value of a fully opaque pixel. */
const OPAQUE = 255;

type Source = ImageBitmap | HTMLImageElement;

/** A decoded source with what is known about it before it is drawn. */
type Loaded = Readonly<{
	source: Source;
	width: number;
	height: number;
	animated: boolean;
	isSvg: boolean;
	/** False for a format without alpha channel: the pixels need no look. */
	mayHaveAlpha: boolean;
	/** Frees the bitmap or the object URL. */
	release: () => void;
}>;

/**
 * Draws a source on a new canvas.
 *
 * @param source The decoded image.
 * @param size The size to draw at.
 * @param size.width Width in pixels.
 * @param size.height Height in pixels.
 * @param background A colour to fill first (JPEG has no transparency); none by default.
 * @returns The canvas, or null when the browser gives no 2D context.
 */
function draw(
	source: Source,
	size: Readonly<{ width: number; height: number }>,
	background?: string,
): HTMLCanvasElement | null {
	const canvas = document.createElement('canvas');
	canvas.width = size.width;
	canvas.height = size.height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (context === null) return null;
	if (background !== undefined) {
		context.fillStyle = background;
		context.fillRect(0, 0, size.width, size.height);
	}
	context.drawImage(source, 0, 0, size.width, size.height);
	return canvas;
}

/**
 * Looks for a pixel that is not fully opaque on a small copy: scaling down blends a few
 * transparent pixels into partly transparent ones, so the probe still finds them.
 *
 * @param loaded The decoded image.
 * @returns Whether any pixel is transparent.
 */
function hasTransparentPixel(loaded: Loaded): boolean {
	const probe = fitWidth(loaded, PROBE_WIDTH);
	const context = draw(loaded.source, probe)?.getContext('2d');
	if (!context) return false;
	const { data } = context.getImageData(0, 0, probe.width, probe.height);
	for (let index = 3; index < data.length; index += 4) {
		if (data[index] !== OPAQUE) return true;
	}
	return false;
}

/**
 * Encodes a canvas.
 *
 * @param canvas The canvas.
 * @param type The format.
 * @param quality The JPEG quality.
 * @returns The encoded image.
 */
async function toBlob(canvas: HTMLCanvasElement, type: OutputType, quality: number): Promise<Blob> {
	// oxlint-disable-next-line promise/avoid-new -- `toBlob` takes a callback; there is no promise version
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob === null) reject(new Error('The canvas gave no image.'));
				else resolve(blob);
			},
			type,
			quality,
		);
	});
}

/**
 * Wraps a loaded image as the decoded image `processImage` works with.
 *
 * @param loaded The loaded image.
 * @returns The decoded image; release frees the source.
 */
function toDecoded(loaded: Loaded): DecodedImage {
	const { animated, height, isSvg, release, source, width } = loaded;
	return {
		animated,
		// oxlint-disable-next-line max-params -- the four arguments are the contract of `DecodedImage`
		encode: async (type, quality, targetWidth, targetHeight) => {
			const background = type === 'image/jpeg' ? '#ffffff' : undefined;
			const canvas = draw(source, { height: targetHeight, width: targetWidth }, background);
			if (canvas === null) throw new Error('No 2D canvas.');
			return toBlob(canvas, type, quality);
		},
		hasAlpha: isSvg || (loaded.mayHaveAlpha && hasTransparentPixel(loaded)),
		height,
		isSvg,
		release,
		width,
	};
}

/**
 * Waits until an `<img>` has loaded an object URL.
 *
 * @param url The object URL.
 * @returns The image, or null when the browser cannot load it.
 */
async function loadImageElement(url: string): Promise<HTMLImageElement | null> {
	const image = new Image();
	image.src = url;
	try {
		await image.decode();
		return image;
	} catch {
		return null;
	}
}

/**
 * Loads an SVG through an `<img>` (the CSP's `img-src blob:` allows it); the canvas draws it
 * later, at the size of `svgRasterSize`: at least 480 px wide in the proportions of its intrinsic
 * size, so a logo with a small or no `width` is not drawn tiny. An SVG without size is no usable
 * image.
 *
 * @param file The SVG.
 * @returns The loaded image, or null.
 */
async function loadSvg(file: Blob): Promise<Loaded | null> {
	const url = URL.createObjectURL(new Blob([file], { type: 'image/svg+xml' }));
	const release = (): void => {
		URL.revokeObjectURL(url);
	};
	const image = await loadImageElement(url);
	if (image === null || image.naturalWidth < 1 || image.naturalHeight < 1) {
		release();
		return null;
	}
	const { height, width } = svgRasterSize({
		height: image.naturalHeight,
		width: image.naturalWidth,
	});
	return {
		animated: false,
		height,
		isSvg: true,
		mayHaveAlpha: true,
		release,
		source: image,
		width,
	};
}

/**
 * Decodes a raster image. `from-image` applies the EXIF rotation, so a portrait photo from a
 * phone stands upright.
 *
 * @param file The image.
 * @returns The loaded image, or null when the browser cannot read it.
 */
async function loadRaster(file: Blob): Promise<Loaded | null> {
	try {
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		return {
			animated: file.type === 'image/gif',
			height: bitmap.height,
			isSvg: false,
			mayHaveAlpha: file.type !== 'image/jpeg',
			release: () => {
				bitmap.close();
			},
			source: bitmap,
			width: bitmap.width,
		};
	} catch {
		return null;
	}
}

/**
 * Decodes an image file in the browser.
 *
 * @param file The file.
 * @returns The decoded image, or null when it is no image.
 */
async function decode(file: Blob): Promise<DecodedImage | null> {
	const isSvg =
		file.type === 'image/svg+xml' || (file instanceof File && /\.svg$/iu.test(file.name));
	const loaded = await (isSvg ? loadSvg(file) : loadRaster(file));
	if (loaded === null) return null;
	try {
		return toDecoded(loaded);
	} catch {
		// The pixel probe failed: nothing else owns the source yet.
		loaded.release();
		return null;
	}
}

/** The decoder `processImage` uses in the browser. */
const browserImageDeps: ImageDeps = { decode };

export { browserImageDeps };
