import { setTimeout as sleep } from 'node:timers/promises';

import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { setUpClub, userWith } from '@/server/contacts/testing';
import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { contacts } from '@/server/db/schema';
import type { Principal } from '@/server/permissions/principal';

import { confirmMemberImport, previewMemberImport } from './members';
import type { ImportPayload } from './payload';
import { memberPayload } from './testing';

/*
 * Two imports at once. PGlite runs one statement at a time, so there two confirms never overlap;
 * this test runs on PostgreSQL with pool connections. It needs `TEST_POSTGRES_URL`, a connection
 * whose user may create databases (CI and `docker/compose.dev.yml` provide one), and is skipped
 * without it. It works in a database of its own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const NOW = new Date('2026-11-24T10:00:00Z');
const WAIT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 20;
const SETUP_TIMEOUT_MS = 60_000;
/** What the confirm that wins reports: one new member, nothing else. */
const WINNER_COUNTS = { changed: 0, created: 1, removed: 0, warnings: 0 };

/**
 * The payload of the members with the given numbers; all data is invented.
 *
 * @param memberNumbers The member numbers.
 * @returns The payload.
 */
function membersPayload(memberNumbers: readonly number[]): ImportPayload {
	return memberPayload(
		memberNumbers.map((number) => [
			String(number),
			'Anna',
			`Beispiel ${number}`,
			`anna.${number}@example.org`,
			'17.05.1980',
			'-',
			'Fußball',
			'Aktiv',
			'weiblich',
		]),
	);
}

/**
 * The numbers of the stored members, sorted numerically.
 *
 * @param db The database.
 * @returns The numbers.
 */
async function storedNumbers(db: Db): Promise<number[]> {
	const rows = await db
		.select({ memberNumber: contacts.memberNumber })
		.from(contacts)
		.where(eq(contacts.kind, 'member'))
		.orderBy(asc(contacts.memberNumber));
	return rows.map((row) => Number(row.memberNumber)).toSorted((a, b) => a - b);
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

describe.skipIf(serverUrl === '')(
	'member import on PostgreSQL (skipped without TEST_POSTGRES_URL)',
	() => {
		const name = `vereinsbote_test_${crypto.randomUUID().replaceAll('-', '')}`;
		let server: DbHandle | undefined;
		let handle: DbHandle | undefined;
		let importer: Principal | undefined;

		beforeAll(async () => {
			server = openPgDb(serverUrl);
			await server.db.execute(sql.raw(`create database "${name}"`));
			const url = new URL(serverUrl);
			url.pathname = `/${name}`;
			handle = openPgDb(url.href);
			await runMigrations(handle.db);
			const { membersAreaId } = await setUpClub(handle.db);
			importer = await userWith(handle.db, { [membersAreaId]: 'edit' });
		}, SETUP_TIMEOUT_MS);

		afterAll(async () => {
			await handle?.end();
			await server?.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
			await server?.end();
		});

		/**
		 * The database and the importer of this test.
		 *
		 * @returns The Drizzle client of the test database and a user with `edit` in "Mitglieder".
		 */
		function testClub(): { db: Db; importer: Principal } {
			if (handle === undefined || importer === undefined) {
				throw new Error('The test database is not open.');
			}
			return { db: handle.db, importer };
		}

		/**
		 * Replaces the stock with the given members.
		 *
		 * @param memberNumbers The member numbers.
		 */
		async function replaceStock(memberNumbers: readonly number[]): Promise<void> {
			const { db, importer: principal } = testClub();
			const payload = membersPayload(memberNumbers);
			const preview = await previewMemberImport(db, principal, payload, NOW);
			const result = await confirmMemberImport(
				db,
				principal,
				payload,
				{ confirmedDeletions: preview.confirmation.deletions, stockVersion: preview.stockVersion },
				NOW,
			);
			if (!result.ok) throw new Error('Replacing the stock failed.');
		}

		it('lets exactly one of two concurrent confirms win', async () => {
			const { db, importer: principal } = testClub();
			await replaceStock([1, 2, 3, 4, 5]);
			const fileA = membersPayload([1, 2, 3, 4, 5, 6]);
			const fileB = membersPayload([1, 2, 3, 4, 5, 7]);
			const previewA = await previewMemberImport(db, principal, fileA, NOW);
			const previewB = await previewMemberImport(db, principal, fileB, NOW);
			expect(previewA.stockVersion).toBe(previewB.stockVersion);

			// A gate holds back every audit entry, the last write of a confirm, so both confirms are
			// in flight at the same time: the first waits at the gate while holding the import state,
			// the second waits for that lock.
			const locked = Promise.withResolvers<boolean>();
			const release = Promise.withResolvers<boolean>();
			const gate = db.transaction(async (tx) => {
				await tx.execute(sql`lock table audit_log in share row exclusive mode`);
				locked.resolve(true);
				await release.promise;
			});
			await locked.promise;
			const confirm = async (
				payload: ImportPayload,
				stockVersion: number,
			): Promise<Awaited<ReturnType<typeof confirmMemberImport>>> =>
				confirmMemberImport(
					db,
					principal,
					payload,
					{ confirmedDeletions: null, stockVersion },
					NOW,
				);
			const results = Promise.allSettled([
				confirm(fileA, previewA.stockVersion),
				confirm(fileB, previewB.stockVersion),
			]);
			await waitForLockWaiters(db, 2);
			release.resolve(true);
			await gate;
			const settled = await results;
			const stored = await storedNumbers(db);

			// Either confirm may take the lock first; the stock is the file of the one that won.
			const won = { status: 'fulfilled', value: { counts: WINNER_COUNTS, ok: true } };
			const lost = { status: 'fulfilled', value: { failure: 'stockChanged', ok: false } };
			expect([
				{ settled: [won, lost], stored: [1, 2, 3, 4, 5, 6] },
				{ settled: [lost, won], stored: [1, 2, 3, 4, 5, 7] },
			]).toContainEqual({ settled, stored });
		});

		it('refuses a confirm after another import changed the stock', async () => {
			const { db, importer: principal } = testClub();
			await replaceStock([1, 2, 3]);
			const stale = membersPayload([1, 2, 3, 4]);
			const preview = await previewMemberImport(db, principal, stale, NOW);
			await replaceStock([1, 2, 3, 8]);
			await expect(
				confirmMemberImport(
					db,
					principal,
					stale,
					{ confirmedDeletions: null, stockVersion: preview.stockVersion },
					NOW,
				),
			).resolves.toStrictEqual({ failure: 'stockChanged', ok: false });
			await expect(storedNumbers(db)).resolves.toStrictEqual([1, 2, 3, 8]);
		});
	},
);
