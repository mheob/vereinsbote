/* oxlint-disable no-magic-numbers -- the numbers are the specification of the two file formats */
/*
 * Image bytes for tests, built here so no binary fixture is needed: a PNG header and a JPEG with
 * the segments of choice. For tests only.
 */
import type { Db } from '@/server/db/client';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_IHDR = [73, 72, 68, 82];
/** Bit depth, colour type, three methods and the CRC. */
const PNG_DETAILS = [8, 6, 0, 0, 0, 0, 0, 0, 0];

function u16(value: number): number[] {
	return [Math.floor(value / 256) % 256, value % 256];
}

function u32(value: number): number[] {
	return [...u16(Math.floor(value / 65_536)), ...u16(value % 65_536)];
}

/**
 * A PNG header of the given size.
 *
 * @param width The width in pixels.
 * @param height The height in pixels.
 * @param length The byte length the file is padded to (default: just the header).
 * @returns The bytes.
 */
function pngBytes(width: number, height: number, length = 0): Uint8Array {
	const head = [
		...PNG_SIGNATURE,
		...u32(13),
		...PNG_IHDR,
		...u32(width),
		...u32(height),
		...PNG_DETAILS,
	];
	const bytes = new Uint8Array(Math.max(length, head.length));
	bytes.set(head);
	return bytes;
}

interface JpegOptions {
	/** Segments before the frame header, each a marker and its payload. */
	readonly segments?: readonly (readonly [number, readonly number[]])[];
	/** The marker of the frame header (default 192, SOF0); null for a JPEG without one. */
	readonly frame?: number | null;
	readonly width?: number;
	readonly height?: number;
}

/**
 * A JPEG with segments, a frame header of the given size and no image data.
 *
 * @param options What goes into the file.
 * @returns The bytes.
 */
function jpegBytes(options: JpegOptions = {}): Uint8Array {
	const { frame = 192, height = 10, segments = [], width = 10 } = options;
	const bytes = [255, 216];
	for (const [marker, payload] of segments) {
		bytes.push(255, marker, ...u16(payload.length + 2), ...payload);
	}
	if (frame !== null) {
		const components = [3, 1, 34, 0, 2, 17, 1, 3, 17, 1];
		bytes.push(255, frame, ...u16(17), 8, ...u16(height), ...u16(width), ...components);
	}
	bytes.push(255, 217);
	return Uint8Array.from(bytes);
}

/**
 * The database with a transaction that always fails, to test what is undone when a write fails.
 *
 * @param db The database.
 * @returns A database that behaves like `db` except for `transaction`.
 */
function withFailingTransactions(db: Db): Db {
	return new Proxy(db, {
		get(target, property, receiver) {
			if (property === 'transaction') throw new Error('write failed');
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
}

export { jpegBytes, pngBytes, withFailingTransactions };
