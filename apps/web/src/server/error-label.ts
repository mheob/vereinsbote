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

/**
 * The label of an error, followed by the label of its `cause` when it has one: libraries that
 * wrap a driver's error (Drizzle does) keep the telling code there, e.g. `28P01` or
 * `ECONNREFUSED`. Like `errorLabel`, never a message.
 *
 * @param error Whatever was thrown.
 * @returns `<label>` or `<label> (cause: <label of the cause>)`.
 */
function errorLabelWithCause(error: unknown): string {
	const label = errorLabel(error);
	if (!(error instanceof Error) || error.cause === undefined) return label;
	return `${label} (cause: ${errorLabel(error.cause)})`;
}

export { errorLabel, errorLabelWithCause };
