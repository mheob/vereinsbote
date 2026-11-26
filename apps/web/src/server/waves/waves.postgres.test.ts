import { randomUUID } from 'node:crypto';

import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { removeAttachment, storeAttachment } from '@/server/attachments/attachments';
import { attachmentCleanup } from '@/server/attachments/cleanup';
import { pdfBytes } from '@/server/attachments/testing';
import { insertContact } from '@/server/contacts/testing';
import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { waitForLockWaiters } from '@/server/db/postgres-testing';
import { attachments, outboxEntries, waveContacts, waves } from '@/server/db/schema';
import type { Principal } from '@/server/permissions/principal';
import { testEnv } from '@/server/sending/testing';
import { createMemoryStorage } from '@/server/storage/memory';
import type { ObjectStorage } from '@/server/storage/storage';
import { APP_ORIGIN } from '@/server/templates/testing';

import { WaveAttachmentsGoneError } from './errors';
import { insertWave, setUpWaveClubOn } from './testing';
import type { WaveClub } from './testing';
import { confirmWave } from './waves';
import type { ConfirmedWave } from './waves';

/*
 * Waves on PostgreSQL. PGlite runs one statement at a time, so it cannot show two confirmations
 * of the same flow (a double click, a retry, a second tab opened before the first confirmation:
 * the server gives them the same key, ruling R19) racing each other. It needs `TEST_POSTGRES_URL`,
 * a connection whose user may create databases (CI and `docker/compose.dev.yml` provide one), and
 * is skipped without it. It works in a database of its own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const SETUP_TIMEOUT_MS = 60_000;
const MEMBERS = 5;
const DAY_MS = 86_400_000;

/** What one way of deleting a file without a wave needs. */
type Removal = Readonly<{ db: Db; storage: ObjectStorage; actor: Principal; id: string }>;

/** The two ways a file without a wave is deleted: by the user, and by the tick's cleanup. */
const REMOVERS: Readonly<Record<string, (removal: Removal) => Promise<unknown>>> = {
	async attachmentCleanup({ db, storage }) {
		return attachmentCleanup.run({
			db,
			deadline: Number.MAX_SAFE_INTEGER,
			env: testEnv(),
			now: () => new Date(),
			storage,
			subrequests: null,
		});
	},
	async removeAttachment({ actor, db, id, storage }) {
		return removeAttachment(db, storage, actor, id);
	},
};

/**
 * How many rows the wave tables hold.
 *
 * @param db The database.
 * @returns The rows of waves, outbox entries and wave contacts.
 */
async function countsOf(db: Db): Promise<{ waves: number; entries: number; contacts: number }> {
	const [waveRows] = await db.select({ n: count() }).from(waves);
	const [entryRows] = await db.select({ n: count() }).from(outboxEntries);
	const [contactRows] = await db.select({ n: count() }).from(waveContacts);
	return { contacts: contactRows?.n ?? 0, entries: entryRows?.n ?? 0, waves: waveRows?.n ?? 0 };
}

describe.skipIf(serverUrl === '')('waves on PostgreSQL (skipped without TEST_POSTGRES_URL)', () => {
	const name = `vereinsbote_test_${randomUUID().replaceAll('-', '')}`;
	const pgWarnings: string[] = [];
	/**
	 * Collects the warnings of node-postgres about queries queued on one client.
	 *
	 * @param warning A process warning.
	 */
	const onWarning = (warning: Readonly<Error>): void => {
		if (warning.message.includes('pg@9')) pgWarnings.push(warning.message);
	};
	let server: DbHandle | undefined;
	let first: DbHandle | undefined;
	let second: DbHandle | undefined;
	let club: WaveClub | undefined;

	beforeAll(async () => {
		process.on('warning', onWarning);
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
		process.off('warning', onWarning);
		await first?.end();
		await second?.end();
		await server?.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
		await server?.end();
	});

	/**
	 * The two connection pools of the test and its club.
	 *
	 * @returns The databases of two requests and the club.
	 */
	function testSetup(): { one: Db; other: Db; club: WaveClub } {
		if (first === undefined || second === undefined || club === undefined) {
			throw new Error('The database was not set up.');
		}
		return { club, one: first.db, other: second.db };
	}

	it('creates one wave for two concurrent confirmations with the same request id', async () => {
		const { club: c, one, other } = testSetup();
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(one, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(),
			name: 'flyer.pdf',
		});
		const confirmation = {
			attachmentIds: [flyer.id],
			notBefore: null,
			occasionId: c.occasionId,
			requestId: randomUUID(),
			selection: { contactIds: null, filters: {}, kind: 'member' as const, query: '' },
		};
		const now = new Date();
		const [fromOne, fromOther] = await Promise.all([
			confirmWave(one, c.sender, confirmation, APP_ORIGIN, now),
			confirmWave(other, c.sender, confirmation, APP_ORIGIN, now),
		]);
		expect(fromOther).toStrictEqual(fromOne);
		expect(fromOne).toMatchObject({ mails: MEMBERS });
		await expect(countsOf(one)).resolves.toStrictEqual({
			contacts: MEMBERS,
			entries: MEMBERS,
			waves: 1,
		});
		expect(pgWarnings).toStrictEqual([]);
	});

	it('waits for a wave of the same flow that is being made and answers with it', async () => {
		const { club: c, one, other } = testSetup();
		const requestId = randomUUID();
		const confirmation = {
			attachmentIds: [],
			notBefore: null,
			occasionId: c.occasionId,
			requestId,
			selection: { contactIds: null, filters: {}, kind: 'member' as const, query: '' },
		};
		let confirming: Promise<ConfirmedWave> | undefined;
		// The first confirmation has made its wave but not committed it yet.
		const waveId = await one.transaction(async (tx) => {
			const id = await insertWave(tx, c.occasionId, { requestId });
			confirming = confirmWave(other, c.sender, confirmation, APP_ORIGIN, new Date());
			await waitForLockWaiters(one, 1);
			return id;
		});
		await expect(confirming).resolves.toStrictEqual({ mails: 0, waveId });
		expect(pgWarnings).toStrictEqual([]);
	});

	it.each(Object.entries(REMOVERS))(
		'lets a confirmation wait while %s deletes a file, then refuses the file',
		async (_remover, remove) => {
			const { club: c, one, other } = testSetup();
			const memory = createMemoryStorage();
			const flyer = await storeAttachment(one, memory, c.sender, c.occasionId, {
				bytes: pdfBytes(),
				name: 'flyer.pdf',
			});
			// Old enough for the cleanup.
			await one
				.update(attachments)
				.set({ createdAt: new Date(Date.now() - 2 * DAY_MS) })
				.where(eq(attachments.id, flyer.id));
			const deleting = Promise.withResolvers<null>();
			const gate = Promise.withResolvers<null>();
			// A storage whose deletion waits until the test lets it go on.
			const storage: ObjectStorage = {
				...memory,
				async delete(key) {
					deleting.resolve(null);
					await gate.promise;
					await memory.delete(key);
				},
			};
			const removing = remove({ actor: c.sender, db: one, id: flyer.id, storage });
			await deleting.promise;
			const wavesBefore = await countsOf(one);
			const confirming = confirmWave(
				other,
				c.sender,
				{
					attachmentIds: [flyer.id],
					notBefore: null,
					occasionId: c.occasionId,
					requestId: randomUUID(),
					selection: { contactIds: null, filters: {}, kind: 'member', query: '' },
				},
				APP_ORIGIN,
				new Date(),
			);
			// The remover holds the row while it deletes the object: the confirmation waits for it.
			await waitForLockWaiters(one, 1);
			gate.resolve(null);
			await removing;
			await expect(confirming).rejects.toBeInstanceOf(WaveAttachmentsGoneError);
			await expect(memory.get(`attachments/${flyer.id}`)).resolves.toBeNull();
			await expect(countsOf(one)).resolves.toStrictEqual(wavesBefore);
		},
	);
});
