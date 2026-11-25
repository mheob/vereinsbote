/* oxlint-disable no-magic-numbers, unicorn/number-literal-case -- the byte layout of the PNG format; the formatter writes hex digits in lowercase */
import { promisify } from 'node:util';
import { crc32, deflate } from 'node:zlib';

/*
 * A small solid-colour PNG, built here from the PNG format (signature, IHDR, IDAT, IEND), so the
 * tests need no binary fixture.
 */

const deflateAsync = promisify(deflate);

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UINT32_BYTES = 4;
const HEADER_BYTES = 13;
/** 8 bit per channel, colour type 2 (RGB), deflate, no filter method, no interlacing. */
const HEADER_TAIL = [8, 2, 0, 0, 0];
const GREY = 0x66;

/**
 * One chunk of a PNG file.
 *
 * @param type The four-letter type.
 * @param data The chunk's data.
 * @returns Length, type, data and checksum.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a Node buffer
function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(UINT32_BYTES);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const checksum = Buffer.alloc(UINT32_BYTES);
	checksum.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, checksum]);
}

/**
 * A solid grey PNG.
 *
 * @param width The width in pixels.
 * @param height The height in pixels.
 * @returns The file.
 */
async function solidPng(width: number, height: number): Promise<Buffer> {
	const header = Buffer.alloc(HEADER_BYTES);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, UINT32_BYTES);
	header.set(HEADER_TAIL, 2 * UINT32_BYTES);
	// Each row starts with its filter type, 0 for none.
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, GREY)]);
	const pixels = Buffer.concat(Array.from({ length: height }, () => row));
	return Buffer.concat([
		SIGNATURE,
		chunk('IHDR', header),
		chunk('IDAT', await deflateAsync(pixels)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

export { solidPng };
