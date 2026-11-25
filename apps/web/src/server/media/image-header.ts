/* oxlint-disable no-magic-numbers -- the numbers are the specification of the two file formats */
/*
 * What a JPEG or PNG says about itself in its first bytes: type and size. The server decides on
 * this, never on a file name or the browser's `File.type`. No server imports.
 */
import type { ImageType } from './ids';

interface ImageHeader {
	type: ImageType;
	width: number;
	height: number;
}

/** Where the walk through a JPEG goes on, or what it found; null when the file is no JPEG. */
type JpegStep = Readonly<{ next: number }> | Readonly<{ header: ImageHeader }> | null;

// Hexadecimal digits are avoided on purpose: the formatter writes them in lowercase, the linter wants uppercase.
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_IHDR = [73, 72, 68, 82];
/** The signature (8), the length of the first chunk (4), its name (4), width (4) and height (4). */
const PNG_HEADER_LENGTH = 24;
const PNG_NAME_OFFSET = 12;
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

const MARKER_START = 255;
const SOI = 216;
const EOI = 217;
const SOS = 218;
const TEM = 1;
const RESTART_FIRST = 208;
const RESTART_LAST = 215;
const FRAME_FIRST = 192;
const FRAME_LAST = 207;
/** Inside the range of the frame markers, but no frames: DHT (define Huffman table), JPG, DAC. */
const NOT_A_FRAME = new Set([196, 200, 204]);
/** A segment's length counts its own two bytes, not the marker. */
const LENGTH_OFFSET = 2;
const FRAME_HEIGHT_OFFSET = 5;
const FRAME_WIDTH_OFFSET = 7;
/** Length field (2), precision (1), height (2), width (2) and the number of components (1). */
const FRAME_MIN_LENGTH = 8;

function startsWith(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
	return expected.every((value, index) => bytes[offset + index] === value);
}

function u16(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
}

function u32(bytes: Uint8Array, offset: number): number {
	return u16(bytes, offset) * 65_536 + u16(bytes, offset + 2);
}

function sized(type: ImageType, width: number, height: number): ImageHeader | null {
	return width === 0 || height === 0 ? null : { height, type, width };
}

function readPng(bytes: Uint8Array): ImageHeader | null {
	if (bytes.length < PNG_HEADER_LENGTH || !startsWith(bytes, PNG_SIGNATURE)) return null;
	if (!startsWith(bytes, PNG_IHDR, PNG_NAME_OFFSET)) return null;
	return sized('png', u32(bytes, PNG_WIDTH_OFFSET), u32(bytes, PNG_HEIGHT_OFFSET));
}

function isFrameMarker(marker: number): boolean {
	return marker >= FRAME_FIRST && marker <= FRAME_LAST && !NOT_A_FRAME.has(marker);
}

function stepSegment(bytes: Uint8Array, offset: number, marker: number): JpegStep {
	const length = u16(bytes, offset + LENGTH_OFFSET);
	if (length < LENGTH_OFFSET || offset + LENGTH_OFFSET + length > bytes.length) return null;
	if (!isFrameMarker(marker)) return { next: offset + LENGTH_OFFSET + length };
	if (length < FRAME_MIN_LENGTH) return null;
	const header = sized(
		'jpeg',
		u16(bytes, offset + FRAME_WIDTH_OFFSET),
		u16(bytes, offset + FRAME_HEIGHT_OFFSET),
	);
	return header === null ? null : { header };
}

function stepJpeg(bytes: Uint8Array, offset: number): JpegStep {
	if (bytes[offset] !== MARKER_START) return null;
	const marker = bytes[offset + 1] ?? 0;
	// Fill bytes before a marker.
	if (marker === MARKER_START) return { next: offset + 1 };
	if (marker === SOS || marker === EOI) return null;
	// Markers without a length field.
	if (marker === TEM || (marker >= RESTART_FIRST && marker <= RESTART_LAST)) {
		return { next: offset + 2 };
	}
	return stepSegment(bytes, offset, marker);
}

function readJpeg(bytes: Uint8Array): ImageHeader | null {
	if (bytes[0] !== MARKER_START || bytes[1] !== SOI) return null;
	let step: JpegStep = { next: 2 };
	// Every step moves on, and the file is at most a few MB, so the walk ends.
	while (step !== null && 'next' in step) step = stepJpeg(bytes, step.next);
	return step === null ? null : step.header;
}

/**
 * Reads type and size of a PNG (its IHDR chunk) or a JPEG (the first frame header, SOF0 to SOF15
 * without the tables DHT, JPG and DAC, which share that range).
 *
 * @param bytes The start of the file, at least up to the frame header.
 * @returns The header, or null for anything else, a truncated file or a size of zero.
 */
function readImageHeader(bytes: Uint8Array): ImageHeader | null {
	return readPng(bytes) ?? readJpeg(bytes);
}

export { readImageHeader };
export type { ImageHeader };
