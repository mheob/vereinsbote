import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';

import { applyMigrations } from './apply-migrations';
import type { Db } from './client';

/** `apps/web/drizzle`, the migrations `drizzle-kit generate` writes. */
const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/**
 * Applies all pending migrations from `apps/web/drizzle`, read from disk: for the migration CLI,
 * the tests and the end-to-end setup. Reads files, so it must not be bundled; the Node server
 * uses `bundledMigrations` instead.
 *
 * @param db The database to migrate.
 */
async function runMigrations(db: Db): Promise<void> {
	await applyMigrations(db, readMigrationFiles({ migrationsFolder }));
}

export { migrationsFolder, runMigrations };
