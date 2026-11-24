/*
 * Reads an import file for the wizard: refuses a file too large to read in the browser before
 * reading it, and one with more rows than an import takes right after (C12), each with the
 * message the file step shows.
 */
import { MAX_IMPORT_ROWS } from '@/server/contacts/import/payload';

import { readFailureMessage } from './import-messages';
import type { Message } from './import-messages';
import { readSheetFile } from './read-sheet';
import type { Sheet } from './read-sheet';

/** Files above 20 MB are not read; a real export of 10 000 rows is far smaller. */
const MAX_FILE_BYTES = 20_000_000;

/** A sheet chosen from the sheets of a workbook read before. */
interface SheetChoice {
	readonly sheetName: string;
	readonly sheetNames: readonly string[];
}

/**
 * A read file, or why it cannot be imported. `sheetNames` lists the sheets to choose from; a
 * refused choice keeps the list of the earlier read, so the user can choose again.
 */
type FileReadOutcome =
	| Readonly<{
			ok: true;
			name: string;
			sheet: Sheet;
			sheetName: string | null;
			sheetNames: readonly string[];
	  }>
	| Readonly<{ ok: false; message: Message; sheetNames: readonly string[] }>;

/**
 * Reads an import file in the browser.
 *
 * @param file The file the user chose or dropped.
 * @param choice The sheet the user chose, with the sheets of the earlier read.
 * @returns The sheet and the sheets of the workbook, or the message why the file is refused.
 */
async function readImportFile(file: File, choice?: SheetChoice): Promise<FileReadOutcome> {
	const sheetNames = choice?.sheetNames ?? [];
	if (file.size > MAX_FILE_BYTES) {
		return { message: { key: 'import.fileTooLarge', params: {} }, ok: false, sheetNames };
	}
	const read = await readSheetFile(file, choice?.sheetName).catch(() => null);
	if (read === null) {
		return { message: { key: 'import.readFailed', params: {} }, ok: false, sheetNames };
	}
	if (!read.ok) return { message: readFailureMessage(read.failure), ok: false, sheetNames };
	if (read.sheet.rows.length > MAX_IMPORT_ROWS) {
		return {
			message: { key: 'import.tooManyRows', params: {} },
			ok: false,
			sheetNames: read.sheetNames,
		};
	}
	return {
		name: file.name,
		ok: true,
		sheet: read.sheet,
		sheetName: read.sheetName,
		sheetNames: read.sheetNames,
	};
}

export { MAX_FILE_BYTES, readImportFile };
export type { FileReadOutcome, SheetChoice };
