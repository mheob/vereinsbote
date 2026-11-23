/**
 * Pool `error` listener shared by all drivers. An idle client that loses its connection emits
 * `error`; unhandled, that kills the process. The pool drops the client and the next query opens
 * a new one, so the listener only logs. Code or name only, never the message: it may carry
 * connection details.
 *
 * @param error The error the pool emitted.
 */
function logPoolError(error: unknown): void {
	const label =
		error instanceof Error
			? (('code' in error ? String(error.code) : undefined) ?? error.name)
			: 'unknown';
	// oxlint-disable-next-line no-console -- the only trace of a flapping database
	console.error('db pool error', label);
}

export { logPoolError };
