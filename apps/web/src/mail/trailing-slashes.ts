/*
 * Cuts the slashes off the end of an address, e.g. of the app origin before a path is appended.
 * A loop instead of `/\/+$/`: that pattern backtracks for each start position of a long run of
 * slashes that does not end the text, which takes quadratic time.
 */

/**
 * A text without the slashes at its end.
 *
 * @param value The text, usually an origin or URL.
 * @returns The text up to its last character that is no slash.
 */
function withoutTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value[end - 1] === '/') end -= 1;
	return value.slice(0, end);
}

export { withoutTrailingSlashes };
