/*
 * Keeps the leading zeros Excel shows for whole numbers formatted with zeros only (`00000`, the
 * format German Excel offers for postal codes). read-excel-file returns the bare number, so the
 * member number `000123` would arrive as `123` and no longer match the same contact read from a
 * CSV file. The formats come from the workbook's XML, read with a few patterns: a part that cannot
 * be read only means no padding. No server imports.
 */

/** The entries of a workbook by path, as fflate unzips them. */
type WorkbookEntries = Readonly<Record<string, Uint8Array>>;

/** Attributes as written, without a namespace prefix (`r:id` → `id`). */
type Attributes = ReadonlyMap<string, string>;

/*
 * Opening tags with any namespace prefix (Strict OpenXML), quoted values may hold `>`. The
 * lookahead keeps `<c` from matching `<col`, `<sheet` from matching `<sheetData` and so on.
 */
const CELL_TAG = /<(?:[\w.-]+:)?c(?=[\s/>])(?<attributes>(?:[^>"']|"[^"]*"|'[^']*')*)>/gu;
const NUM_FMT_TAG = /<(?:[\w.-]+:)?numFmt(?=[\s/>])(?<attributes>(?:[^>"']|"[^"]*"|'[^']*')*)>/gu;
const RELATIONSHIP_TAG =
	/<(?:[\w.-]+:)?Relationship(?=[\s/>])(?<attributes>(?:[^>"']|"[^"]*"|'[^']*')*)>/gu;
const SHEET_TAG = /<(?:[\w.-]+:)?sheet(?=[\s/>])(?<attributes>(?:[^>"']|"[^"]*"|'[^']*')*)>/gu;
const XF_TAG = /<(?:[\w.-]+:)?xf(?=[\s/>])(?<attributes>(?:[^>"']|"[^"]*"|'[^']*')*)>/gu;
/** The cell formats; `<xf>` also occurs in `cellStyleXfs`, whose indices cells do not use. */
const CELL_XFS =
	/<(?:[\w.-]+:)?cellXfs(?=[\s/>])[^>]*>(?<content>[\s\S]*?)<\/(?:[\w.-]+:)?cellXfs>/u;
/** The number formats; `<numFmt>` also occurs in the formats of conditional formatting. */
const NUM_FMTS =
	/<(?:[\w.-]+:)?numFmts(?=[\s/>])[^>]*>(?<content>[\s\S]*?)<\/(?:[\w.-]+:)?numFmts>/u;
const ATTRIBUTE = /(?<name>[\w.:-]+)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/gu;
const RELATIONSHIP_TYPE = /\/relationships\/(?<kind>styles|worksheet)$/u;
const CELL_ADDRESS = /^(?<letters>[A-Z]+)(?<row>[1-9]\d*)$/u;
const ZERO_ONLY_FORMAT = /^0+$/u;
const DIGITS = /^\d+$/u;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const decoder = new TextDecoder();

/**
 * The text of an entry.
 *
 * @param entries The workbook.
 * @param path The path of the entry.
 * @returns The text, empty when the entry is missing.
 */
function entryText(entries: WorkbookEntries, path: string | undefined): string {
	if (path === undefined || !Object.hasOwn(entries, path)) return '';
	const bytes = entries[path];
	return bytes === undefined ? '' : decoder.decode(bytes);
}

/**
 * Reads the attributes of an opening tag.
 *
 * @param source The text between the tag name and `>`.
 * @returns The attributes; namespace declarations are left out.
 */
function attributes(source: string): Attributes {
	const result = new Map<string, string>();
	for (const { groups } of source.matchAll(ATTRIBUTE)) {
		const name = groups?.name ?? 'xmlns';
		if (!name.startsWith('xmlns')) {
			result.set(name.slice(name.indexOf(':') + 1), groups?.double ?? groups?.single ?? '');
		}
	}
	return result;
}

/**
 * The attributes of every tag a pattern matches, in document order.
 *
 * @param xml The XML text.
 * @param tag One of the tag patterns above.
 * @returns The attributes per tag.
 */
function tags(xml: string, tag: Readonly<RegExp>): Attributes[] {
	return Array.from(xml.matchAll(tag), ({ groups }) => attributes(groups?.attributes ?? ''));
}

/**
 * The path of a relationship target, like read-excel-file resolves it.
 *
 * @param target `worksheets/sheet1.xml` (relative to `xl/`) or `/xl/worksheets/sheet1.xml`.
 * @returns The path in the archive.
 */
function targetPath(target: string): string {
	return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/**
 * Finds the styles and the worksheets in the relationships of the workbook.
 *
 * @param entries The workbook.
 * @returns The path of the styles and the worksheet path per relationship id.
 */
function workbookPaths(entries: WorkbookEntries): {
	stylesPath: string;
	worksheets: ReadonlyMap<string, string>;
} {
	const relations = tags(entryText(entries, 'xl/_rels/workbook.xml.rels'), RELATIONSHIP_TAG);
	const targets = relations.flatMap((relation) => {
		const kind = RELATIONSHIP_TYPE.exec(relation.get('Type') ?? '')?.groups?.kind;
		const target = relation.get('Target');
		if (kind === undefined || target === undefined) return [];
		return [{ id: relation.get('Id'), kind, path: targetPath(target) }];
	});
	const worksheets = new Map(
		targets.flatMap(({ id, kind, path }): [string, string][] =>
			kind === 'worksheet' && id !== undefined ? [[id, path]] : [],
		),
	);
	const stylesPath = targets.find(({ kind }) => kind === 'styles')?.path ?? 'xl/styles.xml';
	return { stylesPath, worksheets };
}

/**
 * The width of each cell format (its index in `cellXfs`) whose number format is zeros only.
 *
 * @param styles The text of the styles.
 * @returns The number of zeros per cell format.
 */
function zeroOnlyFormats(styles: string): ReadonlyMap<number, number> {
	const formats = new Map(
		tags(NUM_FMTS.exec(styles)?.groups?.content ?? '', NUM_FMT_TAG).map((numFmt) => [
			numFmt.get('numFmtId'),
			numFmt.get('formatCode') ?? '',
		]),
	);
	const widths = new Map<number, number>();
	for (const [index, xf] of tags(CELL_XFS.exec(styles)?.groups?.content ?? '', XF_TAG).entries()) {
		const format = formats.get(xf.get('numFmtId')) ?? '';
		if (ZERO_ONLY_FORMAT.test(format)) widths.set(index, format.length);
	}
	return widths;
}

/**
 * The 0-based index of a column.
 *
 * @param letters The letters of a cell address (`A`, `AA`).
 * @returns 0 for `A`.
 */
function columnIndex(letters: string): number {
	let number = 0;
	for (const letter of letters) number = number * LETTERS.length + LETTERS.indexOf(letter) + 1;
	return number - 1;
}

/**
 * The cells of a sheet with a zero-only format.
 *
 * @param sheet The text of the worksheet.
 * @param widths The zero-only cell formats.
 * @returns The width per cell, keyed `<row>:<column>` from 0 like read-excel-file's rows.
 */
function zeroOnlyCells(
	sheet: string,
	widths: ReadonlyMap<number, number>,
): ReadonlyMap<string, number> {
	const cells = new Map<string, number>();
	for (const cell of tags(sheet, CELL_TAG)) {
		const width = widths.get(Number(cell.get('s') ?? '0'));
		const address = CELL_ADDRESS.exec(cell.get('r') ?? '')?.groups;
		// Text, booleans and dates arrive as such, `padded` leaves them; the type need not be read.
		if (width !== undefined && address?.letters !== undefined) {
			cells.set(`${Number(address.row) - 1}:${columnIndex(address.letters)}`, width);
		}
	}
	return cells;
}

/**
 * Pads a whole, non-negative number with zeros (only those are written with digits alone). Other
 * numbers keep their value: a zero-only format rounds `12.5` to `00013` for display, which would
 * change the value, and the server's checks see the real one.
 *
 * @param cell The cell as read-excel-file returns it.
 * @param width The number of zeros of the format.
 * @returns The padded text, or the cell as it was.
 */
function padded(cell: unknown, width: number): unknown {
	if (typeof cell !== 'number') return cell;
	const digits = String(cell);
	return DIGITS.test(digits) ? digits.padStart(width, '0') : cell;
}

/**
 * Writes the whole numbers of a sheet whose format is zeros only (`00000`) as the text Excel
 * shows (`01067`). Every other cell stays as read-excel-file returned it.
 *
 * @param entries The unzipped workbook.
 * @param sheetIndex The index of the sheet in the workbook, as in read-excel-file's result.
 * @param data The rows of that sheet from read-excel-file.
 * @returns The rows, padded where the format asks for it.
 */
function keepLeadingZeros(
	entries: WorkbookEntries,
	sheetIndex: number,
	data: readonly (readonly unknown[])[],
): readonly (readonly unknown[])[] {
	const paths = workbookPaths(entries);
	const widths = zeroOnlyFormats(entryText(entries, paths.stylesPath));
	// read-excel-file lists the sheets that have a name, in this order.
	const sheets = tags(entryText(entries, 'xl/workbook.xml'), SHEET_TAG).filter(
		(sheet) => (sheet.get('name') ?? '') !== '',
	);
	const relationId = sheets[sheetIndex]?.get('id');
	const path = relationId === undefined ? undefined : paths.worksheets.get(relationId);
	if (widths.size === 0 || path === undefined) return data;
	const cells = zeroOnlyCells(entryText(entries, path), widths);
	return data.map((row, rowIndex) =>
		row.map((cell, column) => {
			const width = cells.get(`${rowIndex}:${column}`);
			return width === undefined ? cell : padded(cell, width);
		}),
	);
}

export { keepLeadingZeros };
