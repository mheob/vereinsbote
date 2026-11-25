import { describe, expect, it } from 'vite-plus/test';

import { decodeHtmlBytes } from './read-html-file';

/** The characters Windows-1252 puts where Latin-1 has control codes, with their byte. */
const WINDOWS_1252_EXTRAS = new Map([
	['€', 0x80],
	['„', 0x84],
	['“', 0x93],
	['–', 0x96],
]);
/** The highest code point Latin-1 has. */
const LATIN1_MAX = 255;

/**
 * Encodes a text as Windows-1252, the way Word and older Outlook save HTML.
 *
 * @param text The text; every character must exist in Windows-1252.
 * @returns The bytes.
 */
function windows1252(text: string): Uint8Array {
	return Uint8Array.from(text, (char) => {
		const code = WINDOWS_1252_EXTRAS.get(char) ?? char.codePointAt(0) ?? 0;
		if (code > LATIN1_MAX) throw new Error(`${char} is not in the test's Windows-1252 table`);
		return code;
	});
}

function utf8(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/**
 * Bytes written as hexadecimal digits.
 *
 * @param digits Two digits per byte.
 * @returns The bytes.
 */
function hex(digits: string): Uint8Array {
	return Uint8Array.from(Buffer.from(digits, 'hex'));
}

/**
 * Joins byte arrays.
 *
 * @param parts The parts.
 * @returns The bytes one after the other.
 */
function bytes(...parts: readonly Uint8Array[]): Uint8Array {
	return Uint8Array.from(Buffer.concat(parts));
}

const GREETING = 'Grüße vom Verein – „Sommerfest“ für 5 €';

describe(decodeHtmlBytes, () => {
	it('reads UTF-8 without a declaration as UTF-8', () => {
		expect(decodeHtmlBytes(utf8(`<p>${GREETING}</p>`))).toBe(`<p>${GREETING}</p>`);
	});

	it('reads a file without a declaration that is no valid UTF-8 as Windows-1252', () => {
		expect(decodeHtmlBytes(windows1252(`<p>${GREETING}</p>`))).toBe(`<p>${GREETING}</p>`);
	});

	it('follows the charset of a meta element', () => {
		// The bytes C3 BC are „ü“ in UTF-8, but „Ã¼“ in the Windows-1252 the file declares.
		const file = bytes(utf8('<meta charset="windows-1252"><p>'), hex('C3BC'), utf8('</p>'));
		expect(decodeHtmlBytes(file)).toBe('<meta charset="windows-1252"><p>Ã¼</p>');
	});

	it('follows the content type Word writes', () => {
		const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta http-equiv=Content-Type content="text/html; charset=windows-1252"><meta name=Generator content="Microsoft Word 15 (filtered)"></head><body><p>Ã¼</p></body></html>`;
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('takes the encoding Latin-1 labels name: Windows-1252', () => {
		// C3 80 is „À“ in UTF-8, „Ã€“ in Windows-1252 and „Ã“ with a control code in Latin-1.
		const html = `<meta charset='ISO-8859-1'><p>Ã€</p>`;
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('follows a declared UTF-8 even where a byte is broken, as a browser does', () => {
		const file = bytes(utf8('<meta charset=utf-8><p>'), hex('FC'), utf8('</p>'));
		// The broken byte becomes U+FFFD, the replacement character.
		expect(decodeHtmlBytes(file)).toBe('<meta charset=utf-8><p>\uFFFD</p>');
	});

	it('needs the content type pragma for a charset in content', () => {
		// Without `http-equiv="content-type"` the charset in `content` does not count.
		const html = `<meta name="description" content="charset=windows-1252"><p>Ã¼</p>`;
		expect(decodeHtmlBytes(utf8(html))).toBe(html);
	});

	it('reads the charset from a content value with quotes and spaces', () => {
		const html = `<META HTTP-EQUIV="content-type" CONTENT="text/html;charset = 'windows-1252'"><p>Ã¼</p>`;
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('takes the first of the same attribute only', () => {
		const html = '<meta charset="windows-1252" charset="utf-8"><p>Ã¼</p>';
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('gives a byte order mark precedence over a meta element', () => {
		const file = bytes(hex('EFBBBF'), utf8(`<meta charset="windows-1252"><p>${GREETING}</p>`));
		expect(decodeHtmlBytes(file)).toBe(`<meta charset="windows-1252"><p>${GREETING}</p>`);
	});

	it('reads UTF-16 with a byte order mark', () => {
		const html = `<p>${GREETING}</p>`;
		const littleEndian = bytes(hex('FFFE'), Buffer.from(html, 'utf16le'));
		const bigEndian = bytes(hex('FEFF'), Buffer.from(html, 'utf16le').swap16());
		expect(decodeHtmlBytes(littleEndian)).toBe(html);
		expect(decodeHtmlBytes(bigEndian)).toBe(html);
	});

	it('reads a meta element that declares UTF-16 as UTF-8, since the bytes before it were ASCII', () => {
		const html = `<meta charset="utf-16"><p>${GREETING}</p>`;
		expect(decodeHtmlBytes(utf8(html))).toBe(html);
	});

	it('ignores a meta element in a comment, a script-like tag or an attribute value', () => {
		const html = [
			'<!-- <meta charset="windows-1252"> -->',
			'<!DOCTYPE html>',
			'<?xml version="1.0"?>',
			'<p>1 < 2 <= 3</p>',
			'<title data-x="<meta charset=windows-1252>">Ü</title>',
			'</p class="<meta charset=windows-1252>">',
			`<p>${GREETING}</p>`,
		].join('');
		expect(decodeHtmlBytes(utf8(html))).toBe(html);
	});

	it('ends a comment at the first -->, also in <!-->', () => {
		const html = '<!--><meta charset="windows-1252"><p>Ã¼</p>';
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('skips an unknown charset and goes on looking', () => {
		const html = '<meta charset="klingonisch"><meta charset="windows-1252"><p>Ã¼</p>';
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('reads x-user-defined as Windows-1252', () => {
		const html = '<meta charset="x-user-defined"><p>Ã¼</p>';
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('looks for the declaration in the first 1024 bytes only', () => {
		const padding = `<p>${'x'.repeat(1024)}</p>`;
		// Past the first 1024 bytes the declaration counts no more; valid UTF-8 is UTF-8.
		const html = `${padding}<meta charset="windows-1252"><p>${GREETING}</p>`;
		expect(decodeHtmlBytes(utf8(html))).toBe(html);
	});

	it('stops at a comment, a tag or an attribute that does not end', () => {
		for (const head of [
			'<!-- <meta charset="windows-1252">',
			'<!DOCTYPE html <meta charset="windows-1252">',
			'<meta charset="windows-1252',
			'<p class=',
			'<p class',
			'<meta',
		]) {
			expect(decodeHtmlBytes(utf8(`${head}${GREETING}`))).toBe(`${head}${GREETING}`);
		}
	});

	it('reads a meta element closed by a slash and attributes without values', () => {
		const html = '<meta async charset><meta/charset=windows-1252 data-x/><p>Ã¼</p>';
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('reads an unquoted charset in content up to a semicolon or space', () => {
		const html = `<meta content="text/html; charset=windows-1252; x=y" http-equiv="Content-Type"><p>Ã¼</p>`;
		expect(decodeHtmlBytes(windows1252(html))).toBe(html);
	});

	it('ignores a charset in content without an equals sign or with an open quote', () => {
		for (const content of ['charset windows-1252', 'charset="windows-1252', 'charset=']) {
			const html = `<meta http-equiv="content-type" content='${content}'><p>Ã¼</p>`;
			expect(decodeHtmlBytes(utf8(html))).toBe(html);
		}
	});

	it('reads an empty file as empty', () => {
		expect(decodeHtmlBytes(new Uint8Array())).toBe('');
	});
});
