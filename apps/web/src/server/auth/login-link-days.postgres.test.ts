import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { loginLinkDays } from '@/server/db/schema';

import { LOGIN_LINKS_PER_DAY, takeLoginLinkOfDay } from './login-link-days';

/*
 * The day's count of login links under real concurrency: PGlite runs one statement at a time, so
 * there it holds even without an atomic statement. This test runs on PostgreSQL, whose pool sends
 * the requests over several connections at once. It needs `TEST_POSTGRES_URL` (CI and
 * `docker/compose.dev.yml` provide one) and is skipped without it. It works in a database of its
 * own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const SETUP_TIMEOUT_MS = 60_000;
const REQUESTS = 30;

describe.skipIf(serverUrl === '')(
	'login links per day on PostgreSQL (needs TEST_POSTGRES_URL)',
	() => {
		const name = `vereinsbote_test_${crypto.randomUUID().replaceAll('-', '')}`;
		let server: DbHandle | undefined;
		let handle: DbHandle | undefined;

		beforeAll(async () => {
			server = openPgDb(serverUrl);
			await server.db.execute(sql.raw(`create database "${name}"`));
			const url = new URL(serverUrl);
			url.pathname = `/${name}`;
			handle = openPgDb(url.href);
			await runMigrations(handle.db);
		}, SETUP_TIMEOUT_MS);

		/**
		 * The database of this test.
		 *
		 * @returns The Drizzle client of the test database.
		 */
		function testDb(): Db {
			if (handle === undefined) throw new Error('The test database is not open.');
			return handle.db;
		}

		afterAll(async () => {
			await handle?.end();
			await server?.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
			await server?.end();
		});

		it('never counts past the limit when requests for one address come at once', async () => {
			const db = testDb();
			const now = new Date('2026-11-25T11:00:00Z');
			const results = await Promise.all(
				Array.from({ length: REQUESTS }, async () => takeLoginLinkOfDay(db, 'hash-of-anna', now)),
			);
			expect(results.filter(Boolean)).toHaveLength(LOGIN_LINKS_PER_DAY);
			await expect(
				db.select({ count: loginLinkDays.count }).from(loginLinkDays),
			).resolves.toStrictEqual([{ count: LOGIN_LINKS_PER_DAY }]);
		});
	},
);
