import { describe, expect, it } from 'vite-plus/test';

import { safeFileName, sniffAttachmentType } from './signature';
import { bytesOf } from './testing';

describe(sniffAttachmentType, () => {
	it.each([
		['%PDF-1.7 rest', 'application/pdf'],
		['\u00FF\u00D8\u00FF\u00E0 rest', 'image/jpeg'],
		['\u0089PNG\r\n\u001A\n rest', 'image/png'],
		['<html>', null],
		['%PDF', null],
		['', null],
		['GIF89a', null],
	])('sniffs %j as %s', (content, expected) => {
		expect(sniffAttachmentType(bytesOf(content))).toBe(expected);
	});
});

describe(safeFileName, () => {
	it('cleans file names', () => {
		expect(safeFileName('../Anmeldung "Süd".pdf', 'application/pdf')).toBe('Anmeldung Süd.pdf');
	});

	it('drops path parts of both kinds and control characters', () => {
		expect(safeFileName('C:\\Users\\x\\Plan\u0007 A.pdf', 'application/pdf')).toBe('Plan A.pdf');
		expect(safeFileName('a/b/c.pdf', 'application/pdf')).toBe('c.pdf');
	});

	it('makes the extension match the sniffed type', () => {
		expect(safeFileName('foto.pdf', 'image/png')).toBe('foto.png');
		expect(safeFileName('foto.JPEG', 'image/jpeg')).toBe('foto.jpg');
		expect(safeFileName('foto', 'image/jpeg')).toBe('foto.jpg');
		expect(safeFileName('Bericht.v2', 'application/pdf')).toBe('Bericht.v2.pdf');
	});

	it('falls back to a plain name and cuts long names', () => {
		expect(safeFileName('...', 'application/pdf')).toBe('Anhang.pdf');
		expect(safeFileName('', 'image/png')).toBe('Anhang.png');
		const long = safeFileName(`${'a'.repeat(300)}.pdf`, 'application/pdf');
		expect(long).toHaveLength(200);
		expect(long.endsWith('.pdf')).toBe(true);
	});
});
