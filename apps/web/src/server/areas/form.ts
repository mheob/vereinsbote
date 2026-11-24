/** The longest area name, counted after trimming. */
const MAX_AREA_NAME_LENGTH = 60;

/**
 * Tells whether a name can be an area's: 1 to `MAX_AREA_NAME_LENGTH` characters after trimming.
 * The area forms check it in the browser, `createArea` and `renameArea` on the server.
 *
 * @param name The name as typed.
 * @returns True when the name is accepted.
 */
function isValidAreaName(name: string): boolean {
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_AREA_NAME_LENGTH;
}

export { MAX_AREA_NAME_LENGTH, isValidAreaName };
