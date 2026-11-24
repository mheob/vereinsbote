import { describe, expect, it } from 'vite-plus/test';
import writeXlsxFile from 'write-excel-file/node';

import { MAX_IMPORT_ROWS } from '@/server/contacts/import/payload';

import { MAX_FILE_BYTES, readImportFile } from './read-file';

/**
 * A CSV file with the header `Nr.` and numbered rows.
 *
 * @param rows The number of rows.
 * @returns The file.
 */
function numbersCsv(rows: number): File {
	const lines = ['Nr.', ...Array.from({ length: rows }, (_, index) => String(index + 1))];
	return new File([`${lines.join('\r\n')}\r\n`], 'export.csv');
}

describe(readImportFile, () => {
	it('reads a file', async () => {
		await expect(readImportFile(numbersCsv(2))).resolves.toStrictEqual({
			name: 'export.csv',
			ok: true,
			sheet: {
				headers: ['Nr.'],
				rows: [
					{ cells: ['1'], line: 2 },
					{ cells: ['2'], line: 3 },
				],
			},
			sheetName: null,
			sheetNames: [],
		});
	});

	it('refuses a file above the size limit before reading it', async () => {
		// Read, the type alone would refuse it.
		const large = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'export.xls');
		await expect(readImportFile(large)).resolves.toStrictEqual({
			message: { key: 'import.fileTooLarge', params: {} },
			ok: false,
			sheetNames: [],
		});
	});

	it('refuses more rows than an import takes right after reading', async () => {
		await expect(readImportFile(numbersCsv(MAX_IMPORT_ROWS))).resolves.toMatchObject({ ok: true });
		await expect(readImportFile(numbersCsv(MAX_IMPORT_ROWS + 1))).resolves.toStrictEqual({
			message: { key: 'import.tooManyRows', params: {} },
			ok: false,
			sheetNames: [],
		});
	});

	it('names why the reader refused a file', async () => {
		const other = new File(['Nr.\r\n1\r\n'], 'export.ods');
		await expect(readImportFile(other)).resolves.toStrictEqual({
			message: { key: 'import.readFailure.unsupportedType', params: {} },
			ok: false,
			sheetNames: [],
		});
	});

	it('keeps the sheets to choose from when the chosen sheet is empty', async () => {
		const workbook = await writeXlsxFile([
			{ data: [[null]], sheet: 'Deckblatt' },
			{ data: [['Nr.'], [{ type: Number, value: 1001 }]], sheet: 'Mitglieder' },
		]).toBuffer();
		const file = new File([Uint8Array.from(workbook)], 'export.xlsx');
		const sheetNames = ['Deckblatt', 'Mitglieder'];
		await expect(readImportFile(file)).resolves.toMatchObject({
			ok: true,
			sheetName: 'Mitglieder',
			sheetNames,
		});
		await expect(
			readImportFile(file, { sheetName: 'Deckblatt', sheetNames }),
		).resolves.toStrictEqual({
			message: { key: 'import.readFailure.empty', params: {} },
			ok: false,
			sheetNames: ['Deckblatt', 'Mitglieder'],
		});
	});
});
