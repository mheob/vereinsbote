import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from './client';
import { runMigrations } from './migrate';
// oxlint-disable-next-line import/no-namespace -- Drizzle needs the whole schema module
import * as schema from './schema';

/**
 * Migrates a fresh database and dumps its data directory.
 *
 * @returns The uncompressed dump.
 */
async function createTemplate(): Promise<Blob> {
	const client = new PGlite();
	await runMigrations(drizzle(client, { schema }));
	const dump = await client.dumpDataDir('none');
	await client.close();
	return dump;
}

/*
 * A migrated, empty database as a dump, made once per test file while Vitest imports it. A fresh
 * PGlite runs `initdb` first: about 0.5 s on its own and several seconds while every worker
 * starts databases at once, which made tests hit their 5 s timeout. A PGlite started from the
 * dump skips `initdb` and is ready in about 0.1 s. Importing has no timeout, tests have one.
 */
// oxlint-disable-next-line node/no-top-level-await -- see above, the work belongs to the import, not to the first test
const templateDump = await createTemplate();

/**
 * Creates an in-memory PGlite database with all migrations applied.
 *
 * @returns A fresh, isolated database.
 */
async function createTestDb(): Promise<Db> {
	const client = new PGlite({ loadDataDir: templateDump });
	await client.waitReady;
	const db: Db = drizzle(client, { schema });
	return db;
}

export { createTestDb };
