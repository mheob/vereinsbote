import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from './client';
import { runMigrations } from './migrate';
// oxlint-disable-next-line import/no-namespace -- Drizzle needs the whole schema module
import * as schema from './schema';

/**
 * Creates an in-memory PGlite database with all migrations applied.
 *
 * @returns A fresh, isolated database.
 */
async function createTestDb(): Promise<Db> {
	const db: Db = drizzle(new PGlite(), { schema });
	await runMigrations(db);
	return db;
}

export { createTestDb };
