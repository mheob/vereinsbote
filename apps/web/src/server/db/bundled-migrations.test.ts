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

	it(
		'fills the placeholder key of custom fields that exist before the migration',
		freshDatabaseTimeout,
		async () => {
			const client = new PGlite();
			const db: Db = drizzle(client, { schema });
			const migrations = await bundledMigrations();
			// Later migrations (new tables) come after the one that adds the key.
			const index = migrations.findIndex((migration) =>
				migration.sql.join('\n').includes('placeholder_key'),
			);
			expect(index).toBeGreaterThan(0);
			await applyMigrations(db, migrations.slice(0, index));
			await client.exec(`insert into custom_fields (id, kind, name, type, created_at) values
				('00000000-0000-4000-8000-000000000001', 'member', 'Größe', 'text', '2026-01-01'),
				('00000000-0000-4000-8000-000000000002', 'member', 'Groesse!', 'text', '2026-01-02'),
				('00000000-0000-4000-8000-000000000003', 'member', 'GROESSE', 'text', '2026-01-03'),
				('00000000-0000-4000-8000-000000000004', 'partner', 'Größe', 'text', '2026-01-01'),
				('00000000-0000-4000-8000-000000000005', 'member', '123', 'text', '2026-01-04'),
				('00000000-0000-4000-8000-000000000006', 'member', '(-)', 'text', '2026-01-05'),
				('00000000-0000-4000-8000-000000000007', 'member', 'Mitglied seit (alt)', 'date', '2026-01-06'),
				('00000000-0000-4000-8000-000000000008', 'member', 'a', 'text', '2026-01-07'),
				('00000000-0000-4000-8000-000000000009', 'member', 'a!', 'text', '2026-01-08'),
				('00000000-0000-4000-8000-00000000000a', 'member', 'a2', 'text', '2026-01-09'),
				('00000000-0000-4000-8000-00000000000b', 'member', '(+)', 'text', '2026-01-10')`);
			await applyMigrations(db, migrations);
			const { rows } = await client.query<{ kind: string; placeholder_key: string }>(
				'select kind, placeholder_key from custom_fields order by id',
			);
			expect(rows.map(({ kind, placeholder_key }) => `${kind}:${placeholder_key}`)).toStrictEqual([
				'member:groesse',
				'member:groesse_2',
				'member:groesse_3',
				'partner:groesse',
				'member:field123',
				'member:field',
				'member:mitgliedseitalt',
				'member:a',
				'member:a_2',
				'member:a2',
				'member:field_2',
			]);
		},
	);
});
