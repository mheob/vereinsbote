import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { PgDialect, PgSession } from 'drizzle-orm/pg-core';

import type { Db } from './client';

/** A migration as Drizzle's `readMigrationFiles` returns it. */
type Migration = Readonly<Omit<MigrationMeta, 'sql'> & { sql: readonly string[] }>;

// Drizzle's driver migrators all do exactly this on the two members that are internal in its types.
interface MigratableDb {
	dialect: PgDialect;
	session: PgSession;
}

/**
 * Applies the migrations that the database does not have yet, in one transaction, and records
 * them in Drizzle's journal table (`drizzle.__drizzle_migrations`). Driver independent, so it
 * serves the pg, neon and PGlite clients alike.
 *
 * @param db The database to migrate.
 * @param migrations All migrations, oldest first, as Drizzle's `readMigrationFiles` returns them.
 */
async function applyMigrations(db: Db, migrations: readonly Migration[]): Promise<void> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dialect and session are runtime members stripped from the typings
	const { dialect, session } = db as unknown as MigratableDb;
	// Drizzle's types want mutable copies; it only reads them.
	const copies = migrations.map((migration) => ({ ...migration, sql: [...migration.sql] }));
	// The folder only matters to `readMigrationFiles`; the dialect reads table and schema names.
	await dialect.migrate(copies, session, { migrationsFolder: 'drizzle' });
}

export { applyMigrations };
export type { Migration };
