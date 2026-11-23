/**
 * A loggable label for an error: its `code` (database and network errors) or its name. Never
 * the message, which may carry connection details or secrets.
 *
 * @param error Whatever was thrown.
 * @returns The code, the name, or `unknown`.
 */
function errorLabel(error: unknown): string {
	if (!(error instanceof Error)) return 'unknown';
	if ('code' in error && (typeof error.code === 'string' || typeof error.code === 'number')) {
		return String(error.code);
	}
	return error.name;
}

export { errorLabel };
