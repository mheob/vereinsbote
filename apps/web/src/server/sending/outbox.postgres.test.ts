import { setImmediate as nextTurn } from 'node:timers/promises';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { compareCodePoints } from '@/server/compare-code-points';
import { setUpClub } from '@/server/contacts/testing';
import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { outboxEntries, senders } from '@/server/db/schema';
import type { TickStep } from '@/server/tick/tick';

import { openSenderTransport } from './open-transport';
import { claimEntry } from './outbox';
import type { EntryPreparer, PreparedMail } from './outbox';
import { createOutboxStep } from './outbox-step';
import { fakeProviders, graphConnection, senderOn, testEnv } from './testing';
import type { Transport } from './transport';

/*
 * The outbox on PostgreSQL. PGlite runs one statement at a time, so it cannot show two runs
 * taking entries at the same moment. It needs `TEST_POSTGRES_URL`, a connection whose user may
 * create databases (CI and `docker/compose.dev.yml` provide one), and is skipped without it. It
 * works in a database of its own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const SETUP_TIMEOUT_MS = 60_000;
const ENTRIES = 50;
const CLAIMS = 20;
const BUDGET_MS = 60_000;
const WAVE_ID = '00000000-0000-4000-8000-0000000000aa';

const preparer: EntryPreparer = {
	async prepare(_db, entry) {
		await nextTurn();
		const recipient = `${entry.id}@example.org`;
		const prepared: PreparedMail = {
			kind: 'send',
			mail: {
				attachments: [],
				bcc: null,
				from: { address: 'verein@example.org', name: 'Verein' },
				html: '<p>Hallo</p>',
				idempotencyKey: entry.id,
				kind: 'regular',
				listUnsubscribe: null,
				messageId: entry.messageId,
				replyTo: null,
				subject: 'Hallo',
				text: 'Hallo',
				to: recipient,
			},
			recipient,
		};
		return prepared;
	},
};

/**
 * The entry a claim took.
 *
 * @param claim What `claimEntry` gave.
 * @returns The id, or undefined when it took none.
 */
function takenId(claim: Awaited<ReturnType<typeof claimEntry>>): string | undefined {
	return claim === null || claim === 'cancelled' ? undefined : claim.entry.id;
}

/**
 * The clock of the runs: the real one.
 *
 * @returns Now.
 */
function now(): Date {
	return new Date();
}

/**
 * Plans entries of a sender, due now.
 *
 * @param db The database.
 * @param senderId The sender.
 * @param count How many.
 */
async function planEntries(db: Db, senderId: string, count: number): Promise<void> {
	await db.delete(outboxEntries);
	await db.insert(outboxEntries).values(
		Array.from({ length: count }, () => ({
			priority: 'group' as const,
			senderId,
			source: 'wave' as const,
			sourceId: WAVE_ID,
		})),
	);
}

/**
 * A step whose transport records the Message-IDs it sends.
 *
 * @returns The step and the Message-IDs.
 */
function recordingStep(): { step: TickStep; sent: readonly string[] } {
	const sent: string[] = [];
	const transport: Transport = {
		fetchBounces: null,
		probe: null,
		async send(mail) {
			// Give the other run a turn between taking an entry and storing its outcome.
			await nextTurn();
			sent.push(mail.messageId);
			return { ok: true, providerId: null };
		},
	};
	const step = createOutboxStep({
		fetch: fakeProviders().fetch,
		async openTransport(...args) {
			return { ...(await openSenderTransport(...args)), transport };
		},
		preparers: { wave: preparer },
		async sleep() {
			await nextTurn();
		},
	});
	return { sent, step };
}

/**
 * Runs the step once on a database.
 *
 * @param step The step.
 * @param db The database.
 * @returns What the step reports.
 */
async function runOn(step: TickStep, db: Db): Promise<{ moreWork: boolean }> {
	return step.run({
		db,
		deadline: Date.now() + BUDGET_MS,
		env: testEnv(),
		now,
		storage: null,
		subrequests: null,
	});
}

/**
 * Sorts texts by code point.
 *
 * @param texts The texts.
 * @returns A sorted copy.
 */
function sorted(texts: readonly (string | null)[]): (string | null)[] {
	return texts.toSorted((a, b) => compareCodePoints(a ?? '', b ?? ''));
}

describe.skipIf(serverUrl === '')(
	'the outbox on PostgreSQL (skipped without TEST_POSTGRES_URL)',
	() => {
		const name = `vereinsbote_test_${crypto.randomUUID().replaceAll('-', '')}`;
		let server: DbHandle | undefined;
		let first: DbHandle | undefined;
		let second: DbHandle | undefined;
		let senderId: string | undefined;

		beforeAll(async () => {
			server = openPgDb(serverUrl);
			await server.db.execute(sql.raw(`create database "${name}"`));
			const url = new URL(serverUrl);
			url.pathname = `/${name}`;
			first = openPgDb(url.href);
			second = openPgDb(url.href);
			await runMigrations(first.db);
			const { admin } = await setUpClub(first.db);
			const connectionId = await graphConnection(first.db, admin);
			senderId = await senderOn(first.db, admin, connectionId, 'verein@example.org');
			await first.db.update(senders).set({ perMinute: 1000 }).where(eq(senders.id, senderId));
		}, SETUP_TIMEOUT_MS);

		afterAll(async () => {
			await first?.end();
			await second?.end();
			await server?.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
			await server?.end();
		});

		/**
		 * Two connection pools to the database of this test, and its sender.
		 *
		 * @returns The databases of two runs and the sender.
		 */
		function testSetup(): { one: Db; other: Db; senderId: string } {
			if (first === undefined || second === undefined || senderId === undefined) {
				throw new Error('The database was not set up.');
			}
			return { one: first.db, other: second.db, senderId };
		}

		it('takes each entry once when many claims run at the same moment', async () => {
			const { one, senderId: sender } = testSetup();
			await planEntries(one, sender, CLAIMS);
			// The pool runs up to ten of them at once, each on a connection of its own.
			const claims = await Promise.all(
				Array.from({ length: CLAIMS }, async (_, index) =>
					claimEntry(one, {
						messageId: `<claim-${index}@example.org>`,
						now: now(),
						personalOnly: false,
						senderId: sender,
					}),
				),
			);
			const ids = claims.map((claim) => takenId(claim));
			expect(ids.filter((id) => id !== undefined)).toHaveLength(CLAIMS);
			expect(new Set(ids).size).toBe(CLAIMS);
		});

		it('never hands one entry to two concurrent runs', async () => {
			const { one, other, senderId: sender } = testSetup();
			await planEntries(one, sender, ENTRIES);
			const { sent, step } = recordingStep();
			await Promise.all([runOn(step, one), runOn(step, other)]);
			const rows = await one
				.select({ messageId: outboxEntries.messageId, status: outboxEntries.status })
				.from(outboxEntries);
			expect(sent).toHaveLength(ENTRIES);
			expect(new Set(sent).size).toBe(ENTRIES);
			expect(rows.map((row) => row.status)).toStrictEqual(rows.map(() => 'sent'));
			expect(sorted(rows.map((row) => row.messageId))).toStrictEqual(sorted(sent));
		});
	},
);
