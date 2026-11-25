/*
 * The photo of the sample mails: a gradient made here as a PNG, so the repository holds no binary
 * fixture and no real picture.
 */
import { promisify } from 'node:util';
import { crc32, deflate } from 'node:zlib';

const deflateAsync = promisify(deflate);

const PHOTO_WIDTH = 600;
const PHOTO_HEIGHT = 300;

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const COLOR_TYPE_RGB = 2;
const BIT_DEPTH = 8;
const CHANNELS = 3;
const HEADER_BYTES = 13;
const CHUNK_FRAME_BYTES = 8;
const LENGTH_BYTES = 4;
const FILTER_NONE_BYTES = 1;
/** The gradient runs from the top left corner's colour to the bottom right corner's, per channel. */
const GRADIENT_START = Buffer.from('1e5abe', 'hex');
const GRADIENT_END = Buffer.from('5ac864', 'hex');

/**
 * One chunk of a PNG file.
 *
 * @param type The four-letter type.
 * @param data The data.
 * @returns Length, type, data and checksum.
 */
function pngChunk(type: string, data: Uint8Array): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const chunk = Buffer.alloc(body.length + CHUNK_FRAME_BYTES);
	chunk.writeUInt32BE(data.length, 0);
	body.copy(chunk, LENGTH_BYTES);
	chunk.writeUInt32BE(crc32(body), body.length + LENGTH_BYTES);
	return chunk;
}

/**
 * The value of a channel at a position of the gradient.
 *
 * @param channel The channel: 0 red, 1 green, 2 blue.
 * @param position How far along the diagonal, from 0 to 1.
 * @returns The value, from 0 to 255.
 */
function gradient(channel: number, position: number): number {
	const start = GRADIENT_START[channel] ?? 0;
	const end = GRADIENT_END[channel] ?? 0;
	return Math.round(start + (end - start) * position);
}

/**
 * The scanlines of the gradient, each led by filter type 0.
 *
 * @returns The raw pixel data.
 */
function scanlines(): Uint8Array {
	const stride = FILTER_NONE_BYTES + PHOTO_WIDTH * CHANNELS;
	const raw = new Uint8Array(stride * PHOTO_HEIGHT);
	for (let y = 0; y < PHOTO_HEIGHT; y += 1) {
		for (let x = 0; x < PHOTO_WIDTH; x += 1) {
			const position = (x + y) / (PHOTO_WIDTH + PHOTO_HEIGHT);
			for (let channel = 0; channel < CHANNELS; channel += 1) {
				raw[y * stride + FILTER_NONE_BYTES + x * CHANNELS + channel] = gradient(channel, position);
			}
		}
	}
	return raw;
}

/**
 * Makes the sample photo.
 *
 * @returns The bytes of a PNG file of `PHOTO_WIDTH` × `PHOTO_HEIGHT` pixels.
 */
async function samplePhoto(): Promise<Buffer> {
	const header = Buffer.alloc(HEADER_BYTES);
	header.writeUInt32BE(PHOTO_WIDTH, 0);
	header.writeUInt32BE(PHOTO_HEIGHT, LENGTH_BYTES);
	header[LENGTH_BYTES * 2] = BIT_DEPTH;
	header[LENGTH_BYTES * 2 + 1] = COLOR_TYPE_RGB;
	const compressed = await deflateAsync(scanlines());
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk('IHDR', header),
		pngChunk('IDAT', compressed),
		pngChunk('IEND', new Uint8Array()),
	]);
}

export { PHOTO_HEIGHT, PHOTO_WIDTH, samplePhoto };
