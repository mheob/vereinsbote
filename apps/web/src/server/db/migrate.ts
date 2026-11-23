import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { PgDialect, PgSession } from 'drizzle-orm/pg-core';

import type { Db } from './client';

// Drizzle's driver migrators all do exactly this on the two members that are internal in its types.
interface MigratableDb {
	dialect: PgDialect;
	session: PgSession;
}

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/**
 * Applies all pending migrations from `apps/web/drizzle`. Driver independent, so it serves the
 * pg, neon and PGlite clients alike. Reads files, so it must not be bundled for Workers.
 *
 * @param db The database to migrate.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
async function runMigrations(db: Db): Promise<void> {
	const migrations = readMigrationFiles({ migrationsFolder });
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dialect and session are runtime members stripped from the typings
	const { dialect, session } = db as unknown as MigratableDb;
	await dialect.migrate(migrations, session, { migrationsFolder });
}

export { runMigrations };
