import { setTimeout as sleep } from 'node:timers/promises';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { user } from '@/server/db/schema';
import { loadPrincipal } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { insertUser } from './repo';
import { disableUser, LastAdminError, setAdmin } from './users';

/*
 * The last-admin rule under real concurrency. PGlite runs one statement at a time, so there the
 * rule holds even without row locks; this test runs on PostgreSQL with two pool connections. It
 * needs `TEST_POSTGRES_URL`, a connection whose user may create databases (CI and
 * `docker/compose.dev.yml` provide one), and is skipped without it. It works in a database of
 * its own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const WAIT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 20;
const SETUP_TIMEOUT_MS = 60_000;

/**
 * Creates an active admin.
 *
 * @param db The database.
 * @param email The admin's address.
 * @returns The admin's principal.
 */
async function activeAdmin(db: Db, email: string): Promise<Principal> {
	const { id } = await insertUser(db, { email, isAdmin: true, name: email, status: 'active' });
	const principal = await loadPrincipal(db, id);
	if (principal === null) throw new Error('no principal');
	return principal;
}

/**
 * Waits until the given number of connections of this database wait for a lock.
 *
 * @param db The database.
 * @param count How many must wait.
 */
async function waitForLockWaiters(db: Db, count: number): Promise<void> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- polling: each check waits for the previous one
		const [row] = await db
			.select({ waiting: sql<number>`count(*)::int` })
			.from(sql`pg_stat_activity`)
			.where(sql`datname = current_database() and wait_event_type = 'Lock'`);
		if ((row?.waiting ?? 0) >= count) return;
		if (Date.now() > deadline) throw new Error(`Fewer than ${count} connections wait for a lock.`);
		// oxlint-disable-next-line no-await-in-loop -- see above
		await sleep(POLL_INTERVAL_MS);
	}
}

describe.skipIf(serverUrl === '')('the last admin on PostgreSQL (needs TEST_POSTGRES_URL)', () => {
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

	it('lets exactly one of two admins win when they block and demote each other at once', async () => {
		const db = testDb();
		const alex = await activeAdmin(db, 'alex@v.de');
		const bo = await activeAdmin(db, 'bo@v.de');

		// A gate holds back every audit entry, the last write of both changes, so both are in flight
		// at the same time: each has read the admins before either commits, unless a lock serializes
		// them.
		const locked = Promise.withResolvers<boolean>();
		const release = Promise.withResolvers<boolean>();
		const gate = db.transaction(async (tx) => {
			await tx.execute(sql`lock table audit_log in share row exclusive mode`);
			locked.resolve(true);
			await release.promise;
		});
		await locked.promise;
		const changes = Promise.allSettled([
			disableUser(db, alex, bo.userId),
			setAdmin(db, bo, alex.userId, false),
		]);
		// One change waits at the gate; the other waits for it (row lock) or at the gate as well.
		await waitForLockWaiters(db, 2);
		release.resolve(true);
		await gate;
		const results = await changes;

		expect(results.map(({ status }) => status).toSorted()).toStrictEqual(['fulfilled', 'rejected']);
		const refused = results.find((result) => result.status === 'rejected');
		expect(refused?.reason).toBeInstanceOf(LastAdminError);
		const activeAdmins = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.isAdmin, true), eq(user.status, 'active')));
		expect(activeAdmins).toHaveLength(1);
	});
});
