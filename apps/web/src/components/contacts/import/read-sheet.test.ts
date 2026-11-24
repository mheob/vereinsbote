import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vite-plus/test';
import writeXlsxFile from 'write-excel-file/node';
import type { SheetData } from 'write-excel-file/node';

import { MAX_COLUMNS, MAX_HEADER_LENGTH } from '@/server/contacts/import/mapping';

import { decodeCsvBytes, normalizeCell, readSheetFile, toSheet } from './read-sheet';

/** What read-excel-file was given, through the passthrough below. */
const workbookInputs = vi.hoisted((): unknown[] => []);

vi.mock(import('read-excel-file/universal'), async (importOriginal) => {
	const actual = await importOriginal();
	const readXlsxFile: typeof actual.default = async (input, options) => {
		workbookInputs.push(input);
		return actual.default(input, options);
	};
	return { ...actual, default: readXlsxFile };
});

const MAY_17_1980 = new Date(Date.UTC(1980, 4, 17));

function utf8(text: string): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(text);
}

function latin1(text: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(Buffer.from(text, 'latin1'));
}

function csv(text: string | Uint8Array<ArrayBuffer>, name = 'export.csv'): File {
	return new File([text], name);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- write-excel-file takes its own mutable sheet data
async function xlsx(data: SheetData, name = 'export.xlsx'): Promise<File> {
	return new File([Uint8Array.from(await writeXlsxFile(data).toBuffer())], name);
}

/**
 * A CSV file with only a header row `S1;S2;…`.
 *
 * @param count The number of columns.
 * @returns The file.
 */
function headerOnlyCsv(count: number): File {
	return csv(`${Array.from({ length: count }, (_, index) => `S${index + 1}`).join(';')}\r\n`);
}

/**
 * Runs code with the process in another time zone and restores the zone afterwards.
 *
 * @param timeZone An IANA time zone.
 * @param run The code.
 * @returns What the code returns.
 */
function inTimeZone<T>(timeZone: string, run: () => T): T {
	// oxlint-disable-next-line node/no-process-env -- the test moves the process to another time zone
	const original = process.env.TZ;
	try {
		// oxlint-disable-next-line node/no-process-env -- see above
		process.env.TZ = timeZone;
		return run();
	} finally {
		// oxlint-disable-next-line node/no-process-env -- see above
		if (original === undefined) delete process.env.TZ;
		// oxlint-disable-next-line node/no-process-env -- see above
		else process.env.TZ = original;
	}
}

/**
 * The compression methods of the entries of a ZIP archive (0 stored, 8 deflated).
 *
 * @param zip The archive.
 * @returns One method per entry.
 */
function compressionMethods(zip: unknown): number[] {
	if (!(zip instanceof Uint8Array)) throw new TypeError('Not the bytes of an archive.');
	const methods: number[] = [];
	// oxlint-disable-next-line node/no-sync -- fflate, not fs; reads only the entry headers
	unzipSync(zip, {
		filter: (entry) => {
			methods.push(entry.compression);
			return false;
		},
	});
	return methods;
}

describe(decodeCsvBytes, () => {
	it('decodes UTF-8 with and without BOM and falls back to Windows-1252', () => {
		const withBom = utf8('\uFEFFMüller');
		expect(decodeCsvBytes(withBom)).toBe('Müller');
		expect(decodeCsvBytes(utf8('Müller'))).toBe('Müller');
		expect(decodeCsvBytes(latin1('Müller;Straße'))).toBe('Müller;Straße');
	});

	it('reads the characters Windows-1252 adds to Latin-1', () => {
		// „€“ in Windows-1252
		expect(decodeCsvBytes(Uint8Array.of(132, 128, 147))).toBe('„€“');
	});

	it('keeps a file with a BOM in UTF-8 even when a byte is broken', () => {
		const broken = Uint8Array.of(...utf8('\uFEFFA'), 255);
		expect(decodeCsvBytes(broken)).toBe('A\uFFFD');
	});
});

describe(normalizeCell, () => {
	it('writes numbers without decimals they do not have', () => {
		expect(normalizeCell(100_001)).toBe('100001');
		expect(normalizeCell(1.5)).toBe('1.5');
	});

	it('has no text for a number that is not finite', () => {
		expect(normalizeCell(Number.POSITIVE_INFINITY)).toBeNull();
		expect(normalizeCell(Number.NaN)).toBeNull();
	});

	it('writes a date as its calendar day', () => {
		const earlyDate = new Date(Date.UTC(812, 0, 3));
		expect(normalizeCell(MAY_17_1980)).toBe('1980-05-17');
		expect(normalizeCell(earlyDate)).toBe('0812-01-03');
	});

	it('keeps the day of a date in any time zone', () => {
		for (const timeZone of ['Pacific/Honolulu', 'Pacific/Kiritimati']) {
			expect(inTimeZone(timeZone, () => normalizeCell(MAY_17_1980))).toBe('1980-05-17');
		}
	});

	it('keeps text and reads empty cells as missing', () => {
		expect(normalizeCell('Anna')).toBe('Anna');
		expect(normalizeCell('')).toBeNull();
		expect(normalizeCell(null)).toBeNull();
		expect(normalizeCell({})).toBeNull();
		expect(normalizeCell(new Date(Number.NaN))).toBeNull();
	});

	it('writes a boolean as text', () => {
		expect(normalizeCell(true)).toBe('true');
	});
});

describe(toSheet, () => {
	it('names empty and duplicate headers uniquely', () => {
		expect(toSheet([[], ['Nr.', '', 'E-Mail', 'E-Mail', 'E-Mail']])?.headers).toStrictEqual([
			'Nr.',
			'#2',
			'E-Mail',
			'E-Mail (2)',
			'E-Mail (3)',
		]);
	});

	it('never gives a generated name to a second column', () => {
		expect(toSheet([['A', 'A', 'A (2)']])?.headers).toStrictEqual(['A', 'A (3)', 'A (2)']);
		expect(
			toSheet([
				['#2', ''],
				['1', '2'],
			])?.headers,
		).toStrictEqual(['#2', '#2 (2)']);
	});

	it('cleans the headers like cells', () => {
		expect(toSheet([[' Nr. ', 'E-Mail\t', '  ', 'x']])?.headers).toStrictEqual([
			'Nr.',
			'E-Mail',
			'#3',
			'x',
		]);
	});

	it('skips empty rows and keeps file line numbers', () => {
		expect(toSheet([['Nr.'], [], ['7']])?.rows).toStrictEqual([{ cells: ['7'], line: 3 }]);
	});

	it('pads short rows, names columns beyond the header and drops empty columns', () => {
		expect(
			toSheet([
				[null, null, null],
				['Nr.', 'Name', null, null],
				[1, null, 'Notiz', null],
				[2, ' ', null],
				[null, '  ', null, null],
			]),
		).toStrictEqual({
			headers: ['Nr.', 'Name', '#3'],
			rows: [
				{ cells: ['1', null, 'Notiz'], line: 3 },
				{ cells: ['2', ' ', null], line: 4 },
			],
		});
	});

	it('has no sheet without a header', () => {
		expect(toSheet([])).toBeNull();
		expect(toSheet([[null, ''], [' ']])).toBeNull();
	});

	it('keeps a header without rows', () => {
		expect(toSheet([['Nr.', 'Name']])).toStrictEqual({ headers: ['Nr.', 'Name'], rows: [] });
	});
});

describe(readSheetFile, () => {
	it.each([';', ',', '\t'])('detects the delimiter %j', async (delimiter) => {
		const file = csv(`Nr.${delimiter}Name\r\n1${delimiter}Anna\r\n`);
		await expect(readSheetFile(file)).resolves.toMatchObject({
			ok: true,
			sheet: { headers: ['Nr.', 'Name'], rows: [{ cells: ['1', 'Anna'], line: 2 }] },
		});
	});

	it('honours RFC 4180 quotes', async () => {
		const file = csv('Name;Zitat;Notiz\r\n"Abel; Anna";"Er sagte ""Hallo""";"zwei\r\nZeilen"\r\n');
		await expect(readSheetFile(file)).resolves.toMatchObject({
			ok: true,
			sheet: {
				headers: ['Name', 'Zitat', 'Notiz'],
				rows: [{ cells: ['Abel; Anna', 'Er sagte "Hallo"', 'zwei\r\nZeilen'], line: 2 }],
			},
		});
	});

	it('reads a Windows-1252 file and counts blank lines', async () => {
		const file = csv(latin1('Name;Ort\r\n\r\nMüller;Köln\r\n'), 'partner.csv');
		await expect(readSheetFile(file)).resolves.toStrictEqual({
			ok: true,
			sheet: { headers: ['Name', 'Ort'], rows: [{ cells: ['Müller', 'Köln'], line: 3 }] },
			sheetName: null,
			sheetNames: [],
		});
	});

	it('reads a file of one column', async () => {
		const file = csv('E-Mail\r\nanna@example.org\r\n');
		await expect(readSheetFile(file)).resolves.toMatchObject({
			ok: true,
			sheet: { headers: ['E-Mail'], rows: [{ cells: ['anna@example.org'], line: 2 }] },
		});
	});

	it('takes the extension in any case', async () => {
		await expect(readSheetFile(csv('Nr.\r\n1\r\n', 'EXPORT.CSV'))).resolves.toMatchObject({
			ok: true,
		});
	});

	it('reads Excel numbers and dates', async () => {
		const file = await xlsx([
			['Nr.', 'Geburtstag'],
			[
				{ type: Number, value: 100_001 },
				{ format: 'dd.mm.yyyy', type: Date, value: MAY_17_1980 },
			],
		]);
		await expect(readSheetFile(file)).resolves.toMatchObject({
			ok: true,
			sheet: {
				headers: ['Nr.', 'Geburtstag'],
				rows: [{ cells: ['100001', '1980-05-17'], line: 2 }],
			},
			sheetName: 'Sheet1',
			sheetNames: ['Sheet1'],
		});
	});

	it('lists the sheets of a workbook and reads the chosen one', async () => {
		const workbook = await writeXlsxFile([
			{ data: [['Nr.'], [{ type: Number, value: 1001 }]], sheet: 'Mitglieder' },
			{ data: [['Kundennummer'], [], [{ type: Number, value: 100_001 }]], sheet: 'Partner' },
		]).toBuffer();
		const file = new File([Uint8Array.from(workbook)], 'export.xlsx');
		await expect(readSheetFile(file, 'Partner')).resolves.toStrictEqual({
			ok: true,
			sheet: { headers: ['Kundennummer'], rows: [{ cells: ['100001'], line: 3 }] },
			sheetName: 'Partner',
			sheetNames: ['Mitglieder', 'Partner'],
		});
		await expect(readSheetFile(file)).resolves.toMatchObject({
			sheet: { headers: ['Nr.'] },
			sheetName: 'Mitglieder',
		});
		await expect(readSheetFile(file, 'Gelöscht')).resolves.toMatchObject({
			sheet: { headers: ['Nr.'] },
			sheetName: 'Mitglieder',
		});
	});

	it('starts with the first sheet that has text', async () => {
		const workbook = await writeXlsxFile([
			{ data: [[null]], sheet: 'Deckblatt' },
			{ data: [['Nr.'], [{ type: Number, value: 1001 }]], sheet: 'Mitglieder' },
		]).toBuffer();
		const file = new File([Uint8Array.from(workbook)], 'export.xlsx');
		await expect(readSheetFile(file)).resolves.toMatchObject({
			sheet: { headers: ['Nr.'] },
			sheetName: 'Mitglieder',
			sheetNames: ['Deckblatt', 'Mitglieder'],
		});
		await expect(readSheetFile(file, 'Deckblatt')).resolves.toStrictEqual({
			failure: 'empty',
			ok: false,
		});
	});

	it('gives read-excel-file only stored entries, so fflate never inflates in a Worker', async () => {
		// fflate's async unzip, which read-excel-file uses, inflates an entry of 512 KB or more in a
		// Worker from a `blob:` URL, which a CSP without `worker-src blob:` blocks.
		const file = await xlsx([['Nr.'], [{ type: Number, value: 1 }]]);
		const original = new Uint8Array(await file.arrayBuffer());
		expect(compressionMethods(original)).toContain(8);
		workbookInputs.length = 0;

		await readSheetFile(file);

		expect(workbookInputs).toHaveLength(1);
		const methods = compressionMethods(workbookInputs[0]);
		expect(methods.length).toBeGreaterThan(0);
		expect(methods.every((method) => method === 0)).toBe(true);
	});

	it.each([
		['another type', csv('Nr.\r\n1\r\n', 'x.xls'), 'unsupportedType'],
		['no extension', csv('Nr.\r\n1\r\n', 'csv'), 'unsupportedType'],
		['a broken workbook', csv(utf8('PK no zip'), 'x.xlsx'), 'unreadable'],
		['broken quotes', csv('Nr.;Name\r\n"1;Anna\r\n2;Bob\r\n'), 'unreadable'],
		['an empty file', csv(''), 'empty'],
		['blank lines only', csv('\r\n;;\r\n'), 'empty'],
	])('refuses %s', async (_case, file, failure) => {
		await expect(readSheetFile(file)).resolves.toStrictEqual({ failure, ok: false });
	});

	it('refuses an empty workbook', async () => {
		await expect(readSheetFile(await xlsx([]))).resolves.toStrictEqual({
			failure: 'empty',
			ok: false,
		});
	});

	it('refuses more columns than a mapping takes', async () => {
		await expect(readSheetFile(headerOnlyCsv(MAX_COLUMNS))).resolves.toMatchObject({ ok: true });
		await expect(readSheetFile(headerOnlyCsv(MAX_COLUMNS + 1))).resolves.toStrictEqual({
			failure: 'tooManyColumns',
			ok: false,
		});
	});

	it('refuses a header longer than a mapping takes', async () => {
		const longest = 'x'.repeat(MAX_HEADER_LENGTH);
		await expect(readSheetFile(csv(`Nr.;${longest}\r\n`))).resolves.toMatchObject({ ok: true });
		await expect(readSheetFile(csv(`Nr.;${longest}x\r\n`))).resolves.toStrictEqual({
			failure: 'headerTooLong',
			ok: false,
		});
		// The suffix of a repeated header counts as well.
		await expect(readSheetFile(csv(`${longest};${longest}\r\n`))).resolves.toStrictEqual({
			failure: 'headerTooLong',
			ok: false,
		});
	});
});
