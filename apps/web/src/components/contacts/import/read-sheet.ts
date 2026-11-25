/*
 * Reads an import file in the browser: CSV (UTF-8 or Windows-1252, `;`, `,` or tab) and XLSX. The
 * file never leaves the browser; later steps send only the mapped columns. The libraries are
 * loaded with `import()` when a file is read, so they stay out of the page bundle. The production
 * server build drops the imports (`import.meta.env.SSR && import.meta.env.PROD` is a constant
 * there, the unit tests run with `PROD` false): the CI bundle check wants no reading library in
 * the server bundle.
 */
import { MAX_COLUMNS, MAX_HEADER_LENGTH } from '@/server/contacts/import/mapping';
import { cleanText } from '@/server/contacts/import/values';

import { keepLeadingZeros } from './leading-zeros';

/**
 * A row of the file with a cell per column. `line` is its row number in the file, from 1: the
 * row Excel shows (in a CSV file a quoted cell may span lines, it still counts as one row).
 */
interface SheetRow {
	line: number;
	cells: (string | null)[];
}

/** The header row and the rows below it that are not empty. The headers are unique. */
interface Sheet {
	headers: string[];
	rows: SheetRow[];
}

type ReadSheetFailure =
	| 'empty'
	| 'headerTooLong'
	| 'tooManyColumns'
	| 'unreadable'
	| 'unsupportedType';

/** A read file; `sheetNames` is empty and `sheetName` null for CSV. */
type ReadSheetResult =
	| { ok: true; sheetNames: string[]; sheetName: string | null; sheet: Sheet }
	| { ok: false; failure: ReadSheetFailure };

/** The cells of a file, row by row from line 1, and for a workbook its sheets. */
interface Grid {
	cells: readonly (readonly unknown[])[];
	sheetNames: string[];
	sheetName: string | null;
}

/** A sheet of a workbook as read-excel-file returns it; a chart sheet has no `data`. */
interface WorkbookSheet {
	readonly sheet: string;
	readonly data: readonly (readonly unknown[])[] | undefined;
}

/** Reads the bytes of a file; throws when they are not a file of its type. */
type GridReader = (bytes: Uint8Array, sheetName: string | undefined) => Grid | Promise<Grid>;

/** The bytes of a UTF-8 byte order mark. */
const UTF8_BOM = new TextEncoder().encode('\uFEFF');
/** The delimiters a CSV file may use. */
const CSV_DELIMITERS = [';', ',', '\t'];
/** When no delimiter shows, the file has one column; this is German Excel's. */
const FALLBACK_DELIMITER = ';';
/** papaparse guesses the delimiter from the first lines. */
const DELIMITER_GUESS_LINES = 10;
/** What `findIndex` returns when nothing matches. */
const NOT_FOUND = -1;
/** The entries read-excel-file reads from a workbook (its own filter). */
const WORKBOOK_ENTRY = /\.xml(?:\.rels)?$/u;

/**
 * Decodes the bytes of a CSV file: UTF-8 with a BOM or valid UTF-8 as UTF-8, otherwise as
 * Windows-1252 (the „CSV“ of German Excel).
 *
 * @param bytes The file.
 * @returns The text, without a BOM.
 */
function decodeCsvBytes(bytes: Uint8Array): string {
	if (UTF8_BOM.every((byte, index) => bytes[index] === byte)) {
		return new TextDecoder('utf-8').decode(bytes);
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder('windows-1252').decode(bytes);
	}
}

/**
 * Writes a date as its calendar day. read-excel-file returns Excel dates at midnight UTC, so the
 * UTC parts are the day in every time zone of the browser.
 *
 * @param date A valid date.
 * @returns `YYYY-MM-DD`.
 */
function calendarDay(date: Readonly<Date>): string {
	const year = String(date.getUTCFullYear()).padStart(4, '0');
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Turns a cell of a library into text: a date into its calendar day, a number as JavaScript writes
 * it (`100001`, not `100001.0`), an empty text into null. Leading zeros of a zero-only number
 * format are added before, see `leading-zeros.ts`.
 *
 * @param cell The cell as papaparse or read-excel-file returns it.
 * @returns The text, or null for an empty cell.
 */
function normalizeCell(cell: unknown): string | null {
	if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : calendarDay(cell);
	if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : null;
	if (typeof cell === 'boolean') return String(cell);
	if (typeof cell === 'string') return cell === '' ? null : cell;
	return null;
}

/**
 * The number of columns of a row up to its last cell with text (not only spaces).
 *
 * @param cells The cells after `normalizeCell`.
 * @returns 0 for a blank row.
 */
function usedWidth(cells: readonly (string | null)[]): number {
	return cells.findLastIndex((cell) => cleanText(cell) !== '') + 1;
}

/**
 * Tells whether any cell of a grid has text, without reading further than the first one.
 *
 * @param grid The rows, cells as the library returns them.
 * @returns True when the grid has a header.
 */
function hasText(grid: readonly (readonly unknown[])[]): boolean {
	return grid.some((row) => row.some((cell) => cleanText(normalizeCell(cell)) !== ''));
}

/**
 * Picks the sheet to read: the chosen one, otherwise the first one with text, so an empty cover
 * sheet or a chart sheet does not hide the others, otherwise the first one.
 *
 * @param sheets The sheets of the workbook.
 * @param sheetName The chosen sheet, if any.
 * @returns The index of the sheet; 0 for a workbook without sheets.
 */
function sheetIndex(sheets: readonly WorkbookSheet[], sheetName: string | undefined): number {
	const named = sheets.findIndex(({ sheet }) => sheet === sheetName);
	if (named !== NOT_FOUND) return named;
	const withText = sheets.findIndex(({ data }) => hasText(data ?? []));
	return withText === NOT_FOUND ? 0 : withText;
}

/**
 * Makes the headers unique (decision 11 of the plan): an empty header is `#<column number>`, a
 * repeated one gets ` (2)`, ` (3)` …, skipping names another column has.
 *
 * @param cleaned The headers after `cleanText`.
 * @returns The unique headers.
 */
function uniqueHeaders(cleaned: readonly string[]): string[] {
	const named = cleaned.map((header, index) => (header === '' ? `#${index + 1}` : header));
	const taken = new Set(named);
	const used = new Set<string>();
	return named.map((name) => {
		let header = name;
		let number = 2;
		while (used.has(header)) {
			const candidate = `${name} (${number})`;
			if (!taken.has(candidate)) header = candidate;
			number += 1;
		}
		used.add(header);
		return header;
	});
}

/**
 * Builds the sheet from the cells of a file: the first row that is not blank is the header,
 * blank rows below it are skipped, and the columns run up to the last cell with text.
 *
 * @param grid The rows of the file from line 1, cells as the library returns them.
 * @returns The sheet, or null when the file has no header.
 */
function toSheet(grid: readonly (readonly unknown[])[]): Sheet | null {
	const lines = grid.map((row) => row.map((cell) => normalizeCell(cell)));
	const headerIndex = lines.findIndex((cells) => usedWidth(cells) > 0);
	if (headerIndex === NOT_FOUND) return null;
	const [header = [], ...below] = lines.slice(headerIndex);
	const widths = below.map((cells) => usedWidth(cells));
	let width = usedWidth(header);
	for (const rowWidth of widths) width = Math.max(width, rowWidth);
	const padded = (cells: readonly (string | null)[]): (string | null)[] =>
		Array.from({ length: width }, (_, column) => cells[column] ?? null);
	const rows = below.flatMap((cells, index): SheetRow[] =>
		widths[index] === 0 ? [] : [{ cells: padded(cells), line: headerIndex + index + 2 }],
	);
	return { headers: uniqueHeaders(padded(header).map((cell) => cleanText(cell))), rows };
}

/**
 * Loads papaparse and returns the CSV reader. papaparse guesses the delimiter among lines that are
 * not empty only, so it is guessed first; the full parse keeps empty lines for the line numbers.
 *
 * @returns The reader; it throws for broken quotes.
 */
async function loadCsvReader(): Promise<GridReader> {
	if (import.meta.env.SSR && import.meta.env.PROD) throw new Error('browser only');
	const { default: papa } = await import('papaparse');
	return (bytes) => {
		const text = decodeCsvBytes(bytes);
		const guess = papa.parse<string[]>(text, {
			delimitersToGuess: CSV_DELIMITERS,
			preview: DELIMITER_GUESS_LINES,
			skipEmptyLines: 'greedy',
		});
		const undetected = guess.errors.some(({ code }) => code === 'UndetectableDelimiter');
		const delimiter = undetected ? FALLBACK_DELIMITER : guess.meta.delimiter;
		const { data, errors } = papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
		if (errors.some(({ type }) => type === 'Quotes')) throw new Error('The quotes are broken.');
		return { cells: data, sheetName: null, sheetNames: [] };
	};
}

/**
 * Loads fflate and read-excel-file and returns the workbook reader. read-excel-file unzips with
 * fflate's async `unzip`, which inflates an entry of 512 KB or more in a Worker from a `blob:`
 * URL; a CSP without `worker-src blob:` blocks it and the read never ends. So the reader inflates
 * the workbook itself, synchronously, and hands it over with stored (uncompressed) entries.
 *
 * @returns The reader; it reads the chosen sheet (when absent or unknown, the first one with text,
 *   so an empty cover sheet does not hide the others) and throws for a file that is not a workbook.
 */
async function loadWorkbookReader(): Promise<GridReader> {
	if (import.meta.env.SSR && import.meta.env.PROD) throw new Error('browser only');
	const [{ unzipSync, zipSync }, { default: readXlsxFile }] = await Promise.all([
		import('fflate'),
		import('read-excel-file/universal'),
	]);
	return async (bytes, sheetName) => {
		// oxlint-disable-next-line node/no-sync -- fflate, not fs: its async API inflates in a Worker (see above)
		const entries = unzipSync(bytes, { filter: ({ name }) => WORKBOOK_ENTRY.test(name) });
		// oxlint-disable-next-line node/no-sync -- see above; level 0 stores the entries
		const sheets = await readXlsxFile(zipSync(entries, { level: 0 }));
		const index = sheetIndex(sheets, sheetName);
		// The library's type omits that a chart sheet has no `data`.
		const chosen: WorkbookSheet | undefined = sheets[index];
		return {
			// read-excel-file drops the number format: `00000` must keep `01067`.
			cells: chosen === undefined ? [] : keepLeadingZeros(entries, index, chosen.data ?? []),
			sheetName: chosen?.sheet ?? null,
			sheetNames: sheets.map(({ sheet }) => sheet),
		};
	};
}

/**
 * Loads the reader of a file by its extension.
 *
 * @param fileName The name of the file.
 * @returns The reader, or null for a type other than `.csv` and `.xlsx`.
 */
async function loadReader(fileName: string): Promise<GridReader | null> {
	const name = fileName.toLowerCase();
	if (name.endsWith('.csv')) return loadCsvReader();
	if (name.endsWith('.xlsx')) return loadWorkbookReader();
	return null;
}

/**
 * Reads a file with a reader.
 *
 * @param read The reader of the file's type.
 * @param file The file.
 * @param sheetName The sheet of a workbook.
 * @returns The cells, or null when the file cannot be read as its type.
 */
async function readGrid(
	read: GridReader,
	file: File,
	sheetName: string | undefined,
): Promise<Grid | null> {
	try {
		return await read(new Uint8Array(await file.arrayBuffer()), sheetName);
	} catch {
		return null;
	}
}

/**
 * Reads an import file in the browser. A file the mapping could not take (more than `MAX_COLUMNS`
 * columns, a header longer than `MAX_HEADER_LENGTH`) is refused before anything is sent.
 *
 * @param file A `.csv` or `.xlsx` file.
 * @param sheetName The sheet of a workbook; when absent or unknown, the first one with text.
 * @returns The sheet, or why the file cannot be imported.
 */
async function readSheetFile(file: File, sheetName?: string): Promise<ReadSheetResult> {
	// A library that fails to load is no fault of the file, so that error is not caught here.
	const read = await loadReader(file.name);
	if (read === null) return { failure: 'unsupportedType', ok: false };
	const grid = await readGrid(read, file, sheetName);
	if (grid === null) return { failure: 'unreadable', ok: false };
	const sheet = toSheet(grid.cells);
	if (sheet === null) return { failure: 'empty', ok: false };
	if (sheet.headers.length > MAX_COLUMNS) return { failure: 'tooManyColumns', ok: false };
	if (sheet.headers.some((header) => header.length > MAX_HEADER_LENGTH)) {
		return { failure: 'headerTooLong', ok: false };
	}
	return { ok: true, sheet, sheetName: grid.sheetName, sheetNames: grid.sheetNames };
}

export { decodeCsvBytes, normalizeCell, readSheetFile, toSheet };
export type { ReadSheetFailure, ReadSheetResult, Sheet, SheetRow };
