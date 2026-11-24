/**
 * Compares two strings by UTF-16 code unit, the order of `Array#sort` without a compare function,
 * independent of the locale.
 *
 * @param a The first string.
 * @param b The second string.
 * @returns A negative number when `a` sorts first, a positive one when `b` does, else 0.
 */
function compareCodePoints(a: string, b: string): number {
	return Number(a > b) - Number(a < b);
}

export { compareCodePoints };
