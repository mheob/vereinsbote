import { describe, expect, it } from 'vite-plus/test';

import { readImageHeader } from './image-header';
import { jpegBytes, pngBytes } from './testing';

const EXIF_SEGMENT = 225;
const HUFFMAN_TABLE = 196;
const PROGRESSIVE_FRAME = 194;

describe(readImageHeader, () => {
	it('reads a PNG', () => {
		expect(readImageHeader(pngBytes(1200, 800))).toStrictEqual({
			height: 800,
			type: 'png',
			width: 1200,
		});
	});

	it('reads a JPEG whose EXIF segment comes before the frame header', () => {
		const exif = [...new TextEncoder().encode('Exif\0\0'), 1, 2, 3, 4, 5];
		const bytes = jpegBytes({
			frame: PROGRESSIVE_FRAME,
			height: 480,
			segments: [[EXIF_SEGMENT, exif]],
			width: 640,
		});
		expect(readImageHeader(bytes)).toStrictEqual({ height: 480, type: 'jpeg', width: 640 });
	});

	it('reads a baseline JPEG', () => {
		expect(readImageHeader(jpegBytes({ height: 20, width: 10 }))).toStrictEqual({
			height: 20,
			type: 'jpeg',
			width: 10,
		});
	});

	it('skips a Huffman table, which lies in the range of the frame markers', () => {
		const bytes = jpegBytes({ height: 44, segments: [[HUFFMAN_TABLE, [0, 1, 2, 3]]], width: 33 });
		expect(readImageHeader(bytes)).toStrictEqual({ height: 44, type: 'jpeg', width: 33 });
	});

	it('refuses what is no image', () => {
		const encoder = new TextEncoder();
		expect(readImageHeader(encoder.encode('<html><body>x</body></html>'))).toBeNull();
		expect(readImageHeader(encoder.encode('GIF89a\u0001\u0000\u0001\u0000'))).toBeNull();
		expect(readImageHeader(new Uint8Array())).toBeNull();
	});

	it('refuses a truncated PNG', () => {
		expect(readImageHeader(pngBytes(10, 10).slice(0, 20))).toBeNull();
	});

	it('refuses a JPEG without a frame header or cut off in a segment', () => {
		expect(
			readImageHeader(jpegBytes({ frame: null, segments: [[EXIF_SEGMENT, [1, 2, 3]]] })),
		).toBeNull();
		expect(readImageHeader(Uint8Array.from([255, 216, 255]))).toBeNull();
		expect(readImageHeader(jpegBytes().slice(0, 12))).toBeNull();
	});

	it('refuses a PNG whose first chunk is not IHDR', () => {
		const bytes = pngBytes(10, 10);
		bytes.set([88], 12);
		expect(readImageHeader(bytes)).toBeNull();
	});

	it('refuses an image without width or height', () => {
		expect(readImageHeader(pngBytes(0, 10))).toBeNull();
		expect(readImageHeader(jpegBytes({ height: 0 }))).toBeNull();
	});
});
