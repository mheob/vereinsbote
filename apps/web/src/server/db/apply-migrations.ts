import { desc, sql } from 'drizzle-orm';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import { bigint, pgSchema, serial, text } from 'drizzle-orm/pg-core';

import type { Db } from './client';

/** A migration as Drizzle's `readMigrationFiles` returns it. */
type Migration = Readonly<Omit<MigrationMeta, 'sql'> & { sql: readonly string[] }>;

/**
 * The key of the advisory lock the migrations hold: the ASCII of `vbmigrat` as a 64-bit number.
 * Every migration run takes it first, so starters and builds that run at the same time wait for
 * one another instead of applying the same migration twice.
 */
const MIGRATION_LOCK_KEY = '8530217093428388468';

/** Drizzle's journal, `drizzle.__drizzle_migrations`, as `drizzle-kit migrate` creates it too. */
const journal = pgSchema('drizzle').table('__drizzle_migrations', {
	createdAt: bigint('created_at', { mode: 'number' }),
	hash: text('hash').notNull(),
	id: serial('id').primaryKey(),
});

/**
 * Applies the migrations that the database does not have yet and records them in Drizzle's
 * journal, the way Drizzle's own migrator does, but in one transaction that first takes a
 * transaction-level advisory lock (`pg_advisory_xact_lock`). A second run waits for the lock and
 * then finds the migrations recorded. Driver independent, so it serves the pg, neon and PGlite
 * clients alike.
 *
 * @param db The database to migrate.
 * @param migrations All migrations, oldest first, as Drizzle's `readMigrationFiles` returns them.
 */
async function applyMigrations(db: Db, migrations: readonly Migration[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(MIGRATION_LOCK_KEY)})`);
		await tx.execute(sql`create schema if not exists "drizzle"`);
		await tx.execute(
			sql`create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)`,
		);
		const [last] = await tx
			.select({ createdAt: journal.createdAt })
			.from(journal)
			.orderBy(desc(journal.createdAt))
			.limit(1);
		const appliedUntil = last?.createdAt ?? null;
		const pending = migrations.filter(
			({ folderMillis }) => appliedUntil === null || appliedUntil < folderMillis,
		);
		for (const migration of pending) {
			for (const statement of migration.sql) {
				// oxlint-disable-next-line no-await-in-loop -- the statements of a migration run in order
				await tx.execute(sql.raw(statement));
			}
			// oxlint-disable-next-line no-await-in-loop -- see above
			await tx.insert(journal).values({ createdAt: migration.folderMillis, hash: migration.hash });
		}
	});
}

export { MIGRATION_LOCK_KEY, applyMigrations };
export type { Migration };
