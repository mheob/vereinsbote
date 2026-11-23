import { PGlite } from '@electric-sql/pglite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vite-plus/test';

import { applyMigrations } from './apply-migrations';
import { bundledMigrations } from './bundled-migrations';
import type { Db } from './client';
import { migrationsFolder } from './migrate';
// oxlint-disable-next-line import/no-namespace -- Drizzle needs the whole schema module
import * as schema from './schema';

describe(bundledMigrations, () => {
	it('equals the migrations Drizzle reads from the folder', async () => {
		await expect(bundledMigrations()).resolves.toStrictEqual(
			readMigrationFiles({ migrationsFolder }),
		);
	});

	// A fresh PGlite runs `initdb`, which takes seconds while all workers are busy (see test-db.ts).
	const freshDatabaseTimeout = { timeout: 30_000 };

	it(
		'migrates an empty database once, a second run changes nothing',
		freshDatabaseTimeout,
		async () => {
			const client = new PGlite();
			const db: Db = drizzle(client, { schema });
			const migrations = await bundledMigrations();
			await applyMigrations(db, migrations);
			await applyMigrations(db, migrations);
			const { rows } = await client.query<{ count: number }>(
				'select count(*)::int as count from drizzle.__drizzle_migrations',
			);
			expect(rows).toStrictEqual([{ count: migrations.length }]);
		},
	);
});
