/** PostgreSQL's SQLSTATE for a unique violation. */
const UNIQUE_VIOLATION = '23505';
/** How deep to follow `cause`: Drizzle wraps the error of the driver once. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Tells whether a database error is a unique violation. Drizzle wraps the error of the driver
 * (pg, Neon, PGlite) in `cause`, and each of them carries the SQLSTATE in `code`.
 *
 * @param error The error of a query.
 * @returns True for a unique violation.
 */
function isUniqueViolation(error: unknown): boolean {
	let current = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
		if (typeof current !== 'object' || current === null) return false;
		if ('code' in current && current.code === UNIQUE_VIOLATION) return true;
		current = 'cause' in current ? current.cause : undefined;
	}
	return false;
}

export { isUniqueViolation };
