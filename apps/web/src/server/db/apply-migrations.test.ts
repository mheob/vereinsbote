import { PGlite } from '@electric-sql/pglite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vite-plus/test';

import { MIGRATION_LOCK_KEY, applyMigrations } from './apply-migrations';
import type { Migration } from './apply-migrations';
import type { Db } from './client';
import { migrationsFolder } from './migrate';
// oxlint-disable-next-line import/no-namespace -- Drizzle needs the whole schema module
import * as schema from './schema';

// A fresh PGlite runs `initdb`, which takes seconds while all workers are busy (see test-db.ts).
const freshDatabaseTimeout = { timeout: 30_000 };

/** A last migration that records how many advisory locks are held while it runs. */
const lockProbe: Migration = {
	bps: true,
	folderMillis: Number.MAX_SAFE_INTEGER,
	hash: 'lock-probe',
	sql: [
		`create table lock_probe as select count(*)::int as n from pg_locks where locktype = 'advisory'`,
	],
};

describe(applyMigrations, () => {
	it(
		'takes the advisory lock first and holds it while the migrations run',
		freshDatabaseTimeout,
		async () => {
			const queries: string[] = [];
			const client = new PGlite();
			const logger = {
				logQuery(query: string): void {
					queries.push(query);
				},
			};
			const db: Db = drizzle(client, { logger, schema });
			await applyMigrations(db, [...readMigrationFiles({ migrationsFolder }), lockProbe]);
			expect(queries[0]).toBe(`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`);
			const { rows } = await client.query<{ n: number }>('select n from lock_probe');
			expect(rows).toStrictEqual([{ n: 1 }]);
			const locks = await client.query<{ n: number }>(
				`select count(*)::int as n from pg_locks where locktype = 'advisory'`,
			);
			// Released with the transaction.
			expect(locks.rows).toStrictEqual([{ n: 0 }]);
		},
	);
});
