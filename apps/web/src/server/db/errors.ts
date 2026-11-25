/** PostgreSQL's SQLSTATE for a unique violation. */
const UNIQUE_VIOLATION = '23505';
/** PostgreSQL's SQLSTATE for a foreign key violation. */
const FOREIGN_KEY_VIOLATION = '23503';
/** The SQLSTATE of a foreign key with `on delete restrict` (`no action` gives 23503). */
const RESTRICT_VIOLATION = '23001';
/** How deep to follow `cause`: Drizzle wraps the error of the driver once. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Tells whether a database error carries a SQLSTATE. Drizzle wraps the error of the driver (pg,
 * Neon, PGlite) in `cause`, and each of them carries the SQLSTATE in `code`.
 *
 * @param error The error of a query.
 * @param sqlState The SQLSTATE to look for.
 * @returns True when the error or one of its causes has it.
 */
function hasSqlState(error: unknown, sqlState: string): boolean {
	let current = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
		if (typeof current !== 'object' || current === null) return false;
		if ('code' in current && current.code === sqlState) return true;
		current = 'cause' in current ? current.cause : undefined;
	}
	return false;
}

/**
 * Tells whether a database error is a unique violation.
 *
 * @param error The error of a query.
 * @returns True for a unique violation.
 */
function isUniqueViolation(error: unknown): boolean {
	return hasSqlState(error, UNIQUE_VIOLATION);
}

/**
 * Tells whether a database error violates one named foreign key constraint (a refused delete
 * under `on delete restrict` as well as a missing referenced row). Drivers report the
 * constraint's name in `constraint`, on the error or on its cause.
 *
 * @param error The error of a query.
 * @param constraint The name of the foreign key constraint.
 * @returns True when that constraint was violated.
 */
function isForeignKeyViolationOf(error: unknown, constraint: string): boolean {
	let current = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
		if (typeof current !== 'object' || current === null) return false;
		if (
			'code' in current &&
			(current.code === FOREIGN_KEY_VIOLATION || current.code === RESTRICT_VIOLATION) &&
			'constraint' in current &&
			current.constraint === constraint
		) {
			return true;
		}
		current = 'cause' in current ? current.cause : undefined;
	}
	return false;
}

export { isForeignKeyViolationOf, isUniqueViolation };
