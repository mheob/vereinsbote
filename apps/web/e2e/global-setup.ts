import { sql } from 'drizzle-orm';

import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';

import { E2E_DATABASE_URL } from './env';
import { deleteAllMessages } from './helpers/mailpit';

/**
 * Makes every run start from scratch: an empty, migrated database and an empty Mailpit inbox.
 * Playwright starts the web server first; it has migrated the database already and holds no
 * state of its own, so wiping the tables underneath it is safe. Drizzle keeps its journal in the
 * schema `drizzle`, which has to go as well, or the migrations would count as applied.
 */
export default async function globalSetup(): Promise<void> {
	const { db, end } = openPgDb(E2E_DATABASE_URL);
	try {
		await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
		await db.execute(sql`DROP SCHEMA public CASCADE`);
		await db.execute(sql`CREATE SCHEMA public`);
		await runMigrations(db);
	} finally {
		await end();
	}
	await deleteAllMessages();
}
