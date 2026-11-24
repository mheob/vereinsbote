/*
 * The rule of the setting „Frist für alte Daten“: after how many weeks without a member import
 * the data counts as old. No server imports: the settings form checks it in the browser too.
 */

/** The weeks without a stored setting. */
const DEFAULT_STALE_IMPORT_WEEKS = 8;

const MIN_STALE_IMPORT_WEEKS = 1;

/** One year. */
const MAX_STALE_IMPORT_WEEKS = 52;

/**
 * Tells whether a number of weeks is a valid setting: a whole number from
 * `MIN_STALE_IMPORT_WEEKS` to `MAX_STALE_IMPORT_WEEKS`.
 *
 * @param weeks The weeks.
 * @returns True when the setting takes them.
 */
function isValidStaleImportWeeks(weeks: number): boolean {
	return (
		Number.isInteger(weeks) && weeks >= MIN_STALE_IMPORT_WEEKS && weeks <= MAX_STALE_IMPORT_WEEKS
	);
}

export {
	DEFAULT_STALE_IMPORT_WEEKS,
	isValidStaleImportWeeks,
	MAX_STALE_IMPORT_WEEKS,
	MIN_STALE_IMPORT_WEEKS,
};
