import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { insertContact } from '@/server/contacts/testing';
import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { waitForLockWaiters } from '@/server/db/postgres-testing';
import { outboxEntries, waves } from '@/server/db/schema';
import { claimEntry, storeOutcome } from '@/server/sending/outbox';
import type { Claim } from '@/server/sending/outbox';

import { stopWave } from './stop';
import { confirmTestWave, setUpWaveClubOn } from './testing';
import type { WaveClub } from './testing';

/*
 * Stopping a wave on PostgreSQL. PGlite runs one statement at a time, so it cannot show the outbox
 * storing or taking an entry while a stop is being made. It needs `TEST_POSTGRES_URL`, a
 * connection whose user may create databases (CI and `docker/compose.dev.yml` provide one), and
 * is skipped without it. It works in a database of its own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const SETUP_TIMEOUT_MS = 60_000;
const MEMBERS = 8;
const FIVE_MINUTES_MS = 300_000;

/**
 * Takes the next entry of a sender as a run of the outbox does.
 *
 * @param db The database.
 * @param senderId The sender.
 * @returns What `claimEntry` gave.
 */
async function take(db: Db, senderId: string): ReturnType<typeof claimEntry> {
	return claimEntry(db, {
		messageId: `<${randomUUID()}@example.org>`,
		now: new Date(),
		personalOnly: false,
		senderId,
	});
}

/**
 * Takes the next entry of a sender and expects one.
 *
 * @param db The database.
 * @param senderId The sender.
 * @returns The take.
 * @throws {Error} When no entry was taken.
 */
async function takeOne(db: Db, senderId: string): Promise<Claim> {
	const claim = await take(db, senderId);
	if (claim === null || claim === 'cancelled') throw new Error('No entry was taken.');
	return claim;
}

/**
 * The statuses of the entries of a wave that are neither on their way nor cancelled.
 *
 * @param db The database.
 * @param waveId The wave.
 * @returns Their statuses.
 */
async function otherStatuses(db: Db, waveId: string): Promise<string[]> {
	const rows = await db
		.select({ status: outboxEntries.status })
		.from(outboxEntries)
		.where(eq(outboxEntries.waveId, waveId));
	return rows
		.map(({ status }) => status)
		.filter((status) => !['cancelled', 'sending'].includes(status));
}

/**
 * The status of an entry.
 *
 * @param db The database.
 * @param id The entry.
 * @returns Its status.
 */
async function statusOf(db: Db, id: string): Promise<string | undefined> {
	const [row] = await db
		.select({ status: outboxEntries.status })
		.from(outboxEntries)
		.where(eq(outboxEntries.id, id));
	return row?.status;
}

describe.skipIf(serverUrl === '')(
	'stopping waves on PostgreSQL (skipped without TEST_POSTGRES_URL)',
	() => {
		const name = `vereinsbote_test_${randomUUID().replaceAll('-', '')}`;
		let server: DbHandle | undefined;
		let first: DbHandle | undefined;
		let second: DbHandle | undefined;
		let club: WaveClub | undefined;

		beforeAll(async () => {
			server = openPgDb(serverUrl);
			await server.db.execute(sql.raw(`create database "${name}"`));
			const url = new URL(serverUrl);
			url.pathname = `/${name}`;
			first = openPgDb(url.href);
			second = openPgDb(url.href);
			await runMigrations(first.db);
			club = await setUpWaveClubOn(first.db);
			for (let index = 1; index <= MEMBERS; index += 1) {
				// oxlint-disable-next-line no-await-in-loop -- members one after another
				await insertContact(first.db, {
					email: `mitglied-${index}@example.org`,
					kind: 'member',
					memberNumber: String(index),
				});
			}
		}, SETUP_TIMEOUT_MS);

		afterAll(async () => {
			await first?.end();
			await second?.end();
			await server?.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
			await server?.end();
		});

		/**
		 * The two connection pools of the test, its club and a fresh wave to every member; the
		 * entries of earlier tests are gone.
		 *
		 * @returns The databases, the club and the wave.
		 */
		async function freshWave(): Promise<{ one: Db; other: Db; c: WaveClub; waveId: string }> {
			if (first === undefined || second === undefined || club === undefined) {
				throw new Error('The database was not set up.');
			}
			await first.db.delete(outboxEntries);
			const waveId = await confirmTestWave(club, new Date());
			return { c: club, one: first.db, other: second.db, waveId };
		}

		it('cancels a retry that is stored while a stop is being made', async () => {
			const { c, one, other, waveId } = await freshWave();
			const claim = await takeOne(other, c.senderId);
			const retry = { at: new Date(Date.now() + FIVE_MINUTES_MS), code: 'resend.server' } as const;
			let storing: Promise<boolean> | undefined;
			// The stop has marked the wave but not committed yet.
			await one.transaction(async (tx) => {
				await tx.update(waves).set({ stoppedAt: new Date() }).where(eq(waves.id, waveId));
				storing = storeOutcome(other, claim, { ...retry, kind: 'retry' }, new Date());
				await waitForLockWaiters(one, 1);
			});
			await expect(storing).resolves.toBe(true);
			await expect(statusOf(one, claim.entry.id)).resolves.toBe('cancelled');
		});

		it('cancels at its take an entry planned while a stop is being made', async () => {
			const { c, one, other, waveId } = await freshWave();
			let taking: ReturnType<typeof claimEntry> | undefined;
			await one.transaction(async (tx) => {
				await tx.update(waves).set({ stoppedAt: new Date() }).where(eq(waves.id, waveId));
				taking = take(other, c.senderId);
				await waitForLockWaiters(one, 1);
			});
			await expect(taking).resolves.toBe('cancelled');
		});

		it('stops a wave while the outbox takes its entries, without a deadlock', async () => {
			const { c, one, other, waveId } = await freshWave();
			const takes = Array.from({ length: MEMBERS }, async () => take(other, c.senderId));
			await expect(Promise.all([stopWave(one, c.sender, waveId), ...takes])).resolves.toHaveLength(
				MEMBERS + 1,
			);
			await expect(otherStatuses(one, waveId)).resolves.toStrictEqual([]);
		});
	},
);
