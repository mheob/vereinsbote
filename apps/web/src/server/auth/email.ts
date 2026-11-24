/**
 * Brings an e-mail address into the one form the app stores and compares: trimmed and lowercase.
 *
 * @param input The address as typed.
 * @returns The normalized address.
 */
function normalizeEmail(input: string): string {
	return input.trim().toLowerCase();
}

export { normalizeEmail };
