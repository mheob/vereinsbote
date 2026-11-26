import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { auditLog } from '@/server/db/schema';
import { insertUser } from '@/server/users/repo';

import { TEST_MAILS_PER_HOUR } from './test-mail-limit';
import { claimTestMail } from './test-mail-rate';

/*
 * The hourly limit of test mails under real concurrency: PGlite runs one statement at a time, so
 * there it holds even without the lock. This test runs on PostgreSQL, whose pool sends the claims
 * over several connections at once. It needs `TEST_POSTGRES_URL` (CI and
 * `docker/compose.dev.yml` provide one) and is skipped without it. It works in a database of its
 * own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const SETUP_TIMEOUT_MS = 60_000;
const CLAIMS = 30;

describe.skipIf(serverUrl === '')(
	'the hourly limit of test mails on PostgreSQL (needs TEST_POSTGRES_URL)',
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

		it('never claims more than the hour allows when test mails of one user come at once', async () => {
			const db = testDb();
			const { id: userId } = await insertUser(db, {
				email: `tester-${crypto.randomUUID()}@example.org`,
				name: 'Test User',
				status: 'active',
			});
			const now = new Date('2026-11-26T09:00:00Z');
			const occasionId = crypto.randomUUID();
			const claims = await Promise.all(
				Array.from({ length: CLAIMS }, async () =>
					claimTestMail(db, { attachments: 0, now, occasionId, userId }),
				),
			);
			expect(claims.filter((claim) => claim !== null)).toHaveLength(TEST_MAILS_PER_HOUR);
			const [logged] = await db
				.select({ entries: count() })
				.from(auditLog)
				.where(eq(auditLog.actorUserId, userId));
			expect(logged?.entries).toBe(TEST_MAILS_PER_HOUR);
		});
	},
);
