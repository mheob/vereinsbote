import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { Platform, PlatformName } from '@/platform/platform';
import { compareCodePoints } from '@/server/compare-code-points';
import { setUpClub } from '@/server/contacts/testing';
import { SecretDecryptError } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { mailConnections, outboxEntries, senders } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import type { TickStep } from '@/server/tick/tick';

import { openSenderTransport } from './open-transport';
import type { ClaimedEntry, EntryPreparer, PreparedMail } from './outbox';
import { KICK_BUDGET_MS, createOutboxStep, kickOutbox } from './outbox-step';
import type { OutboxDeps } from './outbox-step';
import { quotaToday, scopePause } from './quota';
import { fakeProviders, graphConnection, resendConnection, senderOn, testEnv } from './testing';
import type { OutgoingMail, SendFailureClass, SendResult, Transport } from './transport';

const WAVE_ID = '00000000-0000-4000-8000-0000000000aa';
/** 10:00 in Berlin. */
const START = Date.parse('2026-11-25T09:00:00.000Z');
const BUDGET_MS = 240_000;
const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const OK: SendResult = { ok: true, providerId: 'provider-1' };
const MESSAGE_ID = /^<[\w-]{22}@example\.org>$/u;

type EntryRow = typeof outboxEntries.$inferSelect;

/** A clock the test moves; the step's `sleep` moves it too and is recorded. */
interface TestClock {
	readonly now: () => Date;
	readonly advance: (ms: number) => void;
	readonly sleep: (ms: number) => Promise<void>;
	readonly sleeps: readonly number[];
}

/**
 * A clock that starts at `START`.
 *
 * @returns The clock.
 */
function testClock(): TestClock {
	let current = START;
	const sleeps: number[] = [];
	return {
		advance(ms) {
			current += ms;
		},
		now: () => new Date(current),
		async sleep(ms) {
			sleeps.push(ms);
			current += ms;
			await Promise.resolve();
		},
		sleeps,
	};
}

/**
 * A refusal of the provider.
 *
 * @param failure The class.
 * @param code The code.
 * @returns The result.
 */
function refusal(failure: SendFailureClass, code: string): SendResult {
	return { code, failure, ok: false, retryAfterMs: null };
}

/** An answer that is a refusal until the test opens it. */
interface Gate {
	readonly answer: () => SendResult;
	readonly open: () => void;
}

/**
 * Answers with a refusal until opened, then with `OK`.
 *
 * @param refused The refusal.
 * @returns The gate.
 */
function gate(refused: Readonly<SendResult>): Gate {
	let accepting = false;
	return {
		answer: () => (accepting ? OK : refused),
		open() {
			accepting = true;
		},
	};
}

/** A transport double and the mails it was handed. */
interface TestTransport {
	readonly transport: Transport;
	readonly mails: readonly OutgoingMail[];
	readonly probes: () => number;
}

/**
 * A transport that answers as told.
 *
 * @param answer The answer to the n-th mail (from 0); `throws`: the transport throws an error
 *   that names the address.
 * @param probe The answer to a token check, or null for a transport without one (Resend).
 * @returns The double.
 */
function testTransport(
	answer: (index: number, mail: Readonly<OutgoingMail>) => SendResult | 'throws' = () => OK,
	probe: (() => SendResult) | null = null,
): TestTransport {
	const mails: OutgoingMail[] = [];
	let probes = 0;
	const probeOnce = async (): Promise<SendResult> => {
		probes += 1;
		await Promise.resolve();
		return probe?.() ?? OK;
	};
	return {
		mails,
		probes: () => probes,
		transport: {
			fetchBounces: null,
			probe: probe === null ? null : probeOnce,
			async send(mail) {
				mails.push(mail);
				const answered = answer(mails.length - 1, mail);
				await Promise.resolve();
				if (answered === 'throws') throw new Error(`hang up at ${mail.to}`);
				return answered;
			},
		},
	};
}

/**
 * The address the test preparer sends an entry to.
 *
 * @param entryId The entry.
 * @returns The address.
 */
function addressOf(entryId: string): string {
	return `${entryId}@example.org`;
}

/**
 * The addresses of entries.
 *
 * @param ids The entries.
 * @returns Their addresses.
 */
function addressesOf(ids: readonly string[]): string[] {
	return ids.map((id) => addressOf(id));
}

/**
 * The mail the test preparer makes for an entry.
 *
 * @param claim The entry.
 * @returns The mail.
 */
function testMail(claim: Readonly<ClaimedEntry>): OutgoingMail {
	return {
		attachments: [],
		bcc: null,
		from: { address: 'verein@example.org', name: 'Verein' },
		html: '<p>Hallo</p>',
		idempotencyKey: claim.id,
		kind: 'regular',
		listUnsubscribe: null,
		messageId: claim.messageId,
		replyTo: null,
		subject: 'Hallo',
		text: 'Hallo',
		to: addressOf(claim.id),
	};
}

/** A preparer double and the entries it was handed. */
interface TestPreparer extends EntryPreparer {
	readonly seen: readonly ClaimedEntry[];
}

/**
 * A preparer that hands the test mail, or the given answer for some entries.
 *
 * @param answers The answer per entry id (`throws`: the preparer throws); the test mail for the
 *   others.
 * @returns The preparer.
 */
function testPreparer(
	answers: ReadonlyMap<string, PreparedMail | 'throws'> = new Map(),
): TestPreparer {
	const seen: ClaimedEntry[] = [];
	return {
		async prepare(_db, claim) {
			seen.push({ ...claim });
			await Promise.resolve();
			const answer = answers.get(claim.id);
			if (answer === 'throws') throw new Error('connection lost');
			return answer ?? { kind: 'send', mail: testMail(claim), recipient: addressOf(claim.id) };
		},
		seen,
	};
}

interface StepOptions {
	readonly clock: TestClock;
	readonly transports: ReadonlyMap<string, Transport>;
	/** `null`: no preparer for waves. */
	readonly preparer?: EntryPreparer | null;
	readonly platform?: PlatformName;
	readonly openTransport?: OutboxDeps['openTransport'];
}

/**
 * The outbox step with the transports of the test.
 *
 * @param options The clock, the transport per sender, the preparer and the platform.
 * @returns The step.
 */
function outboxStep(options: Readonly<StepOptions>): TickStep {
	const { clock, preparer = testPreparer(), transports } = options;
	const withTestTransport: OutboxDeps['openTransport'] = async (...args) => {
		const opened = await openSenderTransport(...args);
		const transport = transports.get(opened.sender.id);
		if (transport === undefined) throw new Error('no transport for the sender');
		return { ...opened, transport };
	};
	return createOutboxStep({
		fetch: fakeProviders().fetch,
		openTransport: options.openTransport ?? withTestTransport,
		platform: options.platform ?? 'node',
		preparers: preparer === null ? {} : { wave: preparer },
		sleep: clock.sleep,
	});
}

/** The test database, the clock, and a run of the step. */
interface Harness {
	readonly db: Db;
	readonly clock: TestClock;
}

/**
 * Runs the step once.
 *
 * @param harness The database and the clock.
 * @param step The step.
 * @param budgetMs The time budget.
 * @returns What the step reports.
 */
async function runStep(
	harness: Readonly<Harness>,
	step: TickStep,
	budgetMs = BUDGET_MS,
): Promise<{ moreWork: boolean }> {
	const { clock, db } = harness;
	return step.run({
		db,
		deadline: clock.now().getTime() + budgetMs,
		env: testEnv(),
		now: clock.now,
		storage: null,
	});
}

type EntryValues = Partial<typeof outboxEntries.$inferInsert>;

/**
 * Plans entries of a sender, due at `START` unless told otherwise.
 *
 * @param db The test database.
 * @param senderId The sender.
 * @param count How many.
 * @param values What differs.
 * @returns Their ids.
 */
// oxlint-disable-next-line max-params -- the database, the sender, the count and the values
async function planEntries(
	db: Db,
	senderId: string | null,
	count: number,
	values: Readonly<EntryValues> = {},
): Promise<string[]> {
	const rows = await db
		.insert(outboxEntries)
		.values(
			Array.from({ length: count }, () => ({
				notBefore: new Date(START),
				priority: 'group' as const,
				senderId,
				source: 'wave' as const,
				sourceId: WAVE_ID,
				...values,
			})),
		)
		.returning({ id: outboxEntries.id });
	return rows.map((row) => row.id);
}

/**
 * Reads entries.
 *
 * @param db The test database.
 * @param ids The entries.
 * @returns The rows, in the order of the ids.
 */
async function readEntries(db: Db, ids: readonly string[]): Promise<EntryRow[]> {
	const rows = await db.select().from(outboxEntries).where(inArray(outboxEntries.id, ids));
	return ids.flatMap((id) => rows.filter((row) => row.id === id));
}

/**
 * Reads one entry.
 *
 * @param db The test database.
 * @param id The entry.
 * @returns The row.
 * @throws {Error} When it does not exist.
 */
async function readEntry(db: Db, id: string): Promise<EntryRow> {
	const [row] = await readEntries(db, [id]);
	if (row === undefined) throw new Error('no such entry');
	return row;
}

/**
 * Answers in turn, then with `OK`.
 *
 * @param answers The answers to the first mails.
 * @returns The answer to the n-th mail.
 */
function inTurn(
	answers: readonly (Readonly<SendResult> | 'throws')[],
): (index: number) => SendResult | 'throws' {
	return (index) => answers[index] ?? OK;
}

/**
 * The wait of a planned entry until its next attempt.
 *
 * @param harness The database and the clock.
 * @param id The entry.
 * @returns The milliseconds from now, or null when it waits for none.
 */
async function pendingWait(harness: Readonly<Harness>, id: string): Promise<number | null> {
	const row = await readEntry(harness.db, id);
	if (row.status !== 'planned' || row.nextAttemptAt === null) return null;
	return row.nextAttemptAt.getTime() - harness.clock.now().getTime();
}

/**
 * The wait of an entry that waits for its next attempt.
 *
 * @param harness The database and the clock.
 * @param id The entry.
 * @returns The milliseconds from now.
 * @throws {Error} When the entry waits for no attempt.
 */
async function waitOf(harness: Readonly<Harness>, id: string): Promise<number> {
	const wait = await pendingWait(harness, id);
	if (wait === null) throw new Error('the entry waits for no attempt');
	return wait;
}

/**
 * Runs the step at every next attempt of an entry until it waits for none.
 *
 * @param harness The database and the clock.
 * @param step The step.
 * @param id The entry.
 * @returns The waits it saw after each run.
 */
async function runUntilSettled(
	harness: Readonly<Harness>,
	step: TickStep,
	id: string,
): Promise<number[]> {
	const waits: number[] = [];
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- the attempts follow one another
		await runStep(harness, step);
		// oxlint-disable-next-line no-await-in-loop -- see above
		const wait = await pendingWait(harness, id);
		if (wait === null) return waits;
		waits.push(wait);
		harness.clock.advance(wait);
	}
}

/**
 * A club with one Graph sender.
 *
 * @param db The test database.
 * @param values Columns of the sender to set (limits).
 * @returns The sender and its connection.
 */
async function graphSender(
	db: Db,
	values: Readonly<Partial<typeof senders.$inferInsert>> = {},
): Promise<{ senderId: string; connectionId: string }> {
	const { admin } = await setUpClub(db);
	const connectionId = await graphConnection(db, admin);
	const senderId = await senderOn(db, admin, connectionId, 'verein@example.org');
	await db
		.update(senders)
		.set({ ...values, updatedAt: new Date(START) })
		.where(eq(senders.id, senderId));
	return { connectionId, senderId };
}

/**
 * A club with one Resend connection and two senders on it.
 *
 * @param db The test database.
 * @returns The senders and the connection.
 */
async function resendSenders(
	db: Db,
): Promise<{ first: string; second: string; connectionId: string }> {
	const { admin } = await setUpClub(db);
	const connectionId = await resendConnection(db, admin);
	const first = await senderOn(db, admin, connectionId, 'a@example.org');
	const second = await senderOn(db, admin, connectionId, 'b@example.org');
	return { connectionId, first, second };
}

/**
 * Marks a connection as disturbed.
 *
 * @param db The test database.
 * @param connectionId The connection.
 * @param code The code of the refusal.
 * @returns Since when.
 */
async function disturbed(db: Db, connectionId: string, code: string): Promise<Date> {
	const since = new Date(START - HOUR_MS);
	await db
		.update(mailConnections)
		.set({ disturbedCode: code, disturbedSince: since })
		.where(eq(mailConnections.id, connectionId));
	return since;
}

/**
 * The disturbance of a connection.
 *
 * @param db The test database.
 * @param connectionId The connection.
 * @returns Since when and why it is disturbed.
 */
async function disturbance(
	db: Db,
	connectionId: string,
): Promise<{ since: Date | null; code: string | null }> {
	const [row] = await db
		.select({ code: mailConnections.disturbedCode, since: mailConnections.disturbedSince })
		.from(mailConnections)
		.where(eq(mailConnections.id, connectionId));
	return row ?? { code: null, since: null };
}

/**
 * The status, attempts and code of entries.
 *
 * @param rows The rows.
 * @returns One triple per row.
 */
function statesOf(rows: readonly EntryRow[]): [string, number, string | null][] {
	return rows.map((row) => [row.status, row.attempts, row.lastErrorCode]);
}

/**
 * The states of entries in a fixed order, for entries whose order of sending is free.
 *
 * @param rows The rows.
 * @returns The triples, sorted.
 */
function sortedStatesOf(rows: readonly EntryRow[]): [string, number, string | null][] {
	return statesOf(rows).toSorted((a, b) => compareCodePoints(JSON.stringify(a), JSON.stringify(b)));
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

/**
 * The work of a kicked run that throws before it hands over a promise.
 *
 * @returns Never.
 * @throws {Error} Always.
 */
// oxlint-disable-next-line typescript/promise-function-async -- the test needs a function that throws before it returns a promise
function throwingRun(): Promise<unknown> {
	throw new Error('kaputt');
}

describe(createOutboxStep, () => {
	it('sends due entries and stores message id and provider id', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { db } = harness;
		const { senderId } = await graphSender(db);
		const due = await planEntries(db, senderId, 2);
		const [later = ''] = await planEntries(db, senderId, 1, {
			notBefore: new Date(START + HOUR_MS),
		});
		const preparer = testPreparer();
		const { mails, transport } = testTransport((_index, mail) => ({
			ok: true,
			providerId: `provider-${mail.to}`,
		}));
		const step = outboxStep({
			clock: harness.clock,
			preparer,
			transports: new Map([[senderId, transport]]),
		});
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		const rows = await readEntries(db, [...due, later]);
		expect(
			rows.map((row) => ({
				attempts: row.attempts,
				messageId: MESSAGE_ID.test(String(row.messageId)),
				providerId: row.providerId,
				recipient: row.recipient,
				sentAt: row.sentAt,
				status: row.status,
			})),
		).toStrictEqual([
			...due.map((id) => ({
				attempts: 1,
				messageId: true,
				providerId: `provider-${addressOf(id)}`,
				recipient: addressOf(id),
				sentAt: harness.clock.now(),
				status: 'sent',
			})),
			{
				attempts: 0,
				messageId: false,
				providerId: null,
				recipient: null,
				sentAt: null,
				status: 'planned',
			},
		]);
		expect(sorted(mails.map((mail) => `${mail.to} ${mail.messageId}`))).toStrictEqual(
			sorted(rows.slice(0, 2).map((row) => `${addressOf(row.id)} ${row.messageId}`)),
		);
		expect(preparer.seen.toSorted((a, b) => compareCodePoints(a.id, b.id))).toStrictEqual(
			rows
				.slice(0, 2)
				.toSorted((a, b) => compareCodePoints(a.id, b.id))
				.map((row) => ({
					attempts: 0,
					id: row.id,
					messageId: row.messageId,
					priority: 'group',
					senderId,
					source: 'wave',
					sourceId: WAVE_ID,
				})),
		);
		await expect(quotaToday(db, `sender:${senderId}`, harness.clock.now())).resolves.toMatchObject({
			used: 2,
		});
	});

	it('sends with the message id and the address of the entry whatever the mail says', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db);
		const [id = ''] = await planEntries(harness.db, senderId, 1);
		const claim = {
			attempts: 0,
			id,
			messageId: '<x@example.org>',
			priority: 'group',
			senderId,
			source: 'wave',
			sourceId: WAVE_ID,
		} as const;
		const mail = { ...testMail(claim), messageId: '<other@example.org>', to: 'x@example.org' };
		const preparer = testPreparer(
			new Map([[id, { kind: 'send', mail, recipient: addressOf(id) }]]),
		);
		const { mails, transport } = testTransport();
		const transports = new Map([[senderId, transport]]);
		await runStep(harness, outboxStep({ clock: harness.clock, preparer, transports }));
		const row = await readEntry(harness.db, id);
		expect(mails.map((sent) => [sent.to, sent.messageId])).toStrictEqual([
			[addressOf(id), row.messageId],
		]);
		expect(row.messageId).toMatch(MESSAGE_ID);
	});

	it('throttles to perMinute per scope', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db);
		await planEntries(harness.db, senderId, 31);
		const { mails, transport } = testTransport();
		const step = outboxStep({ clock: harness.clock, transports: new Map([[senderId, transport]]) });
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		expect(mails).toHaveLength(31);
		expect(harness.clock.sleeps).toStrictEqual([MINUTE_MS]);
	});

	it('shares the throttle of a resend connection between its senders', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { db } = harness;
		const { connectionId, first, second } = await resendSenders(db);
		await db
			.update(mailConnections)
			.set({ perMinute: 2 })
			.where(eq(mailConnections.id, connectionId));
		await planEntries(db, first, 3);
		await planEntries(db, second, 2);
		const one = testTransport();
		const other = testTransport();
		const transports = new Map([
			[first, one.transport],
			[second, other.transport],
		]);
		await runStep(harness, outboxStep({ clock: harness.clock, transports }));
		expect([one.mails.length, other.mails.length]).toStrictEqual([3, 2]);
		expect(harness.clock.sleeps).toStrictEqual([MINUTE_MS, MINUTE_MS]);
	});

	it('counts the sends of the last minute from an earlier run', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { db } = harness;
		const { senderId } = await graphSender(db);
		await planEntries(db, senderId, 30);
		const { mails, transport } = testTransport();
		const step = outboxStep({ clock: harness.clock, transports: new Map([[senderId, transport]]) });
		await runStep(harness, step);
		await planEntries(db, senderId, 1, { notBefore: harness.clock.now() });
		harness.clock.advance(10 * SECOND_MS);
		await runStep(harness, step);
		expect(mails).toHaveLength(31);
		expect(harness.clock.sleeps).toStrictEqual([50 * SECOND_MS]);
	});

	it('reports more work when the budget ends before the next window', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db);
		await planEntries(harness.db, senderId, 31);
		const { mails, transport } = testTransport();
		const step = outboxStep({ clock: harness.clock, transports: new Map([[senderId, transport]]) });
		await expect(runStep(harness, step, 30 * SECOND_MS)).resolves.toStrictEqual({
			moreWork: true,
		});
		expect(mails).toHaveLength(30);
		expect(harness.clock.sleeps).toStrictEqual([]);
	});

	it('sends at most 40 mails per sender and run on cloudflare', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db, { perMinute: 100 });
		await planEntries(harness.db, senderId, 41);
		const { mails, transport } = testTransport();
		const step = outboxStep({
			clock: harness.clock,
			platform: 'cloudflare',
			transports: new Map([[senderId, transport]]),
		});
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: true });
		expect(mails).toHaveLength(40);
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		expect(mails).toHaveLength(41);
	});

	it('reports no more work at the cloudflare limit when only reserved capacity is left', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { db } = harness;
		const { senderId } = await graphSender(db, { dailyLimit: 41, perMinute: 100 });
		await planEntries(db, senderId, 41);
		// Due at 12:00: it keeps one mail of the limit free for itself.
		await planEntries(db, senderId, 1, {
			notBefore: new Date(START + 2 * HOUR_MS),
			priority: 'personal',
		});
		const { mails, transport } = testTransport();
		const step = outboxStep({
			clock: harness.clock,
			platform: 'cloudflare',
			transports: new Map([[senderId, transport]]),
		});
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		expect(mails).toHaveLength(40);
	});

	it.each([
		[BUDGET_MS, 220],
		[KICK_BUDGET_MS, 15],
	])(
		'leaves the later steps room before a deadline %i ms away (%i sends)',
		async (budgetMs, sends) => {
			const harness = { clock: testClock(), db: await createTestDb() };
			const { senderId } = await graphSender(harness.db, { perMinute: 1000 });
			await planEntries(harness.db, senderId, 250);
			const { mails, transport } = testTransport(() => {
				harness.clock.advance(SECOND_MS);
				return OK;
			});
			const step = outboxStep({
				clock: harness.clock,
				transports: new Map([[senderId, transport]]),
			});
			await expect(runStep(harness, step, budgetMs)).resolves.toStrictEqual({ moreWork: true });
			expect(mails).toHaveLength(sends);
		},
	);

	it('starts no send after the clock passed the deadline between two sends', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db);
		await planEntries(harness.db, senderId, 3);
		const { mails, transport } = testTransport(() => {
			harness.clock.advance(31 * SECOND_MS);
			return OK;
		});
		const step = outboxStep({ clock: harness.clock, transports: new Map([[senderId, transport]]) });
		await expect(runStep(harness, step, 30 * SECOND_MS)).resolves.toStrictEqual({
			moreWork: true,
		});
		expect(mails).toHaveLength(1);
	});

	it('sends personal before group and keeps the reserve', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { clock, db } = harness;
		const { senderId } = await graphSender(db, { dailyLimit: 3 });
		const groups = await planEntries(db, senderId, 3);
		const [personalNow = ''] = await planEntries(db, senderId, 1, { priority: 'personal' });
		// Due at 12:00 in Berlin: its share of the limit stays free all morning.
		const [personalLater = ''] = await planEntries(db, senderId, 1, {
			notBefore: new Date(START + 2 * HOUR_MS),
			priority: 'personal',
		});
		const { mails, transport } = testTransport();
		const step = outboxStep({ clock, transports: new Map([[senderId, transport]]) });
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		const morning = mails.map((mail) => mail.to);
		clock.advance(2 * HOUR_MS);
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		const noon = mails.map((mail) => mail.to).slice(morning.length);
		clock.advance(DAY_MS);
		await runStep(harness, step);
		expect({ morning, noon }).toStrictEqual({
			morning: [addressOf(personalNow), expect.toBeOneOf(addressesOf(groups))],
			noon: [addressOf(personalLater)],
		});
		const rows = await readEntries(db, [...groups, personalNow, personalLater]);
		expect(rows.map((row) => row.status)).toStrictEqual(Array.from({ length: 5 }, () => 'sent'));
	});

	it('retries transient failures with growing delays and fails after five attempts', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db);
		const [id = ''] = await planEntries(harness.db, senderId, 1);
		const { mails, transport } = testTransport(() => refusal('transient', 'graph.server'));
		const step = outboxStep({ clock: harness.clock, transports: new Map([[senderId, transport]]) });
		await runStep(harness, step);
		const firstWait = await waitOf(harness, id);
		harness.clock.advance(firstWait - 1);
		await runStep(harness, step);
		expect(mails).toHaveLength(1);
		harness.clock.advance(1);
		const waits = [firstWait, ...(await runUntilSettled(harness, step, id))];
		expect(waits).toStrictEqual([300_000, 1_800_000, 7_200_000, 28_800_000]);
		harness.clock.advance(DAY_MS);
		await runStep(harness, step);
		expect(statesOf([await readEntry(harness.db, id)])).toStrictEqual([
			['failed', 5, 'graph.server'],
		]);
		expect({
			ids: new Set(mails.map((mail) => mail.messageId)).size,
			mails: mails.length,
		}).toStrictEqual({
			ids: 1,
			mails: 5,
		});
	});

	it('fails rejected recipients at once', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db);
		const [id = ''] = await planEntries(harness.db, senderId, 1);
		const { mails, transport } = testTransport(() => refusal('rejected', 'graph.recipient'));
		const step = outboxStep({ clock: harness.clock, transports: new Map([[senderId, transport]]) });
		await runStep(harness, step);
		harness.clock.advance(DAY_MS);
		await runStep(harness, step);
		expect(statesOf([await readEntry(harness.db, id)])).toStrictEqual([
			['failed', 1, 'graph.recipient'],
		]);
		expect(mails).toHaveLength(1);
	});

	it('marks a disturbed connection and keeps its entries without spending attempts', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { clock, db } = harness;
		const { connectionId, senderId } = await graphSender(db);
		const ids = await planEntries(db, senderId, 2);
		const refused = gate(refusal('unauthorized', 'graph.unauthorized'));
		const { mails, probes, transport } = testTransport(refused.answer, refused.answer);
		const step = outboxStep({ clock, transports: new Map([[senderId, transport]]) });
		await runStep(harness, step);
		clock.advance(5 * MINUTE_MS);
		await runStep(harness, step);
		const whileDisturbed = {
			disturbance: await disturbance(db, connectionId),
			entries: sortedStatesOf(await readEntries(db, ids)),
			mails: mails.length,
			probes: probes(),
		};
		expect(whileDisturbed).toStrictEqual({
			disturbance: { code: 'graph.unauthorized', since: new Date(START) },
			entries: [
				['planned', 0, 'graph.unauthorized'],
				['planned', 0, null],
			],
			mails: 1,
			probes: 1,
		});
		refused.open();
		clock.advance(5 * MINUTE_MS);
		await runStep(harness, step);
		const afterwards = {
			disturbance: await disturbance(db, connectionId),
			entries: statesOf(await readEntries(db, ids)),
			mails: mails.length,
			probes: probes(),
		};
		expect(afterwards).toStrictEqual({
			disturbance: { code: null, since: null },
			entries: [
				['sent', 1, null],
				['sent', 1, null],
			],
			mails: 3,
			probes: 2,
		});
	});

	it('probes a refused mailbox with one entry instead of a token', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { clock, db } = harness;
		const { connectionId, senderId } = await graphSender(db);
		await planEntries(db, senderId, 3);
		const since = await disturbed(db, connectionId, 'graph.mailbox');
		const refused = gate(refusal('unauthorized', 'graph.mailbox'));
		const { mails, probes, transport } = testTransport(refused.answer, () => OK);
		const step = outboxStep({ clock, transports: new Map([[senderId, transport]]) });
		await runStep(harness, step);
		const whileRefused = {
			disturbance: await disturbance(db, connectionId),
			mails: mails.length,
			probes: probes(),
		};
		refused.open();
		clock.advance(5 * MINUTE_MS);
		await runStep(harness, step);
		expect(whileRefused).toStrictEqual({
			disturbance: { code: 'graph.mailbox', since },
			mails: 1,
			probes: 0,
		});
		expect({
			disturbance: await disturbance(db, connectionId),
			mails: mails.length,
			probes: probes(),
		}).toStrictEqual({ disturbance: { code: null, since: null }, mails: 4, probes: 0 });
	});

	it('tries one entry per run on a disturbed resend connection', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { clock, db } = harness;
		const { connectionId, first, second } = await resendSenders(db);
		const since = await disturbed(db, connectionId, 'resend.unauthorized');
		const ids = [...(await planEntries(db, first, 2)), ...(await planEntries(db, second, 1))];
		const refused = gate(refusal('unauthorized', 'resend.unauthorized'));
		const one = testTransport(refused.answer);
		const other = testTransport(refused.answer);
		const transports = new Map([
			[first, one.transport],
			[second, other.transport],
		]);
		const step = outboxStep({ clock, transports });
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		const tried = one.mails.length + other.mails.length;
		const stillDisturbed = await disturbance(db, connectionId);
		refused.open();
		clock.advance(5 * MINUTE_MS);
		await runStep(harness, step);
		expect({ stillDisturbed, tried }).toStrictEqual({
			stillDisturbed: { code: 'resend.unauthorized', since },
			tried: 1,
		});
		expect(one.mails.length + other.mails.length).toBe(4);
		await expect(disturbance(db, connectionId)).resolves.toStrictEqual({ code: null, since: null });
		const rows = await readEntries(db, ids);
		expect(rows.map((row) => row.status)).toStrictEqual(['sent', 'sent', 'sent']);
	});

	it('marks the connection disturbed when the credentials cannot be opened', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const { connectionId, senderId } = await graphSender(harness.db);
		const [id = ''] = await planEntries(harness.db, senderId, 1);
		const openTransport = vi
			.fn<NonNullable<OutboxDeps['openTransport']>>()
			.mockRejectedValue(new SecretDecryptError());
		const step = outboxStep({ clock: harness.clock, openTransport, transports: new Map() });
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		expect(statesOf([await readEntry(harness.db, id)])).toStrictEqual([['planned', 0, null]]);
		await expect(disturbance(harness.db, connectionId)).resolves.toStrictEqual({
			code: 'outbox.credentials',
			since: new Date(START),
		});
		expect(log).toHaveBeenCalledWith('outbox transport not opened', 'SecretDecryptError');
		log.mockRestore();
	});

	it('leaves the connection alone when opening a transport fails for another reason', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { connectionId, senderId } = await graphSender(harness.db);
		const [id = ''] = await planEntries(harness.db, senderId, 1);
		const openTransport = vi
			.fn<NonNullable<OutboxDeps['openTransport']>>()
			.mockRejectedValue(new Error('connection reset'));
		const step = outboxStep({ clock: harness.clock, openTransport, transports: new Map() });
		await expect(runStep(harness, step)).rejects.toThrow('connection reset');
		expect(statesOf([await readEntry(harness.db, id)])).toStrictEqual([['planned', 0, null]]);
		await expect(disturbance(harness.db, connectionId)).resolves.toStrictEqual({
			code: null,
			since: null,
		});
	});

	it('pauses the scope on a quota refusal without spending attempts', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { clock, db } = harness;
		const { connectionId, first, second } = await resendSenders(db);
		const ids = [...(await planEntries(db, first, 2)), ...(await planEntries(db, second, 2))];
		const { mails, transport } = testTransport(() => ({
			...refusal('quota', 'resend.quota'),
			retryAfterMs: 3 * HOUR_MS,
		}));
		const transports = new Map([
			[first, transport],
			[second, transport],
		]);
		const step = outboxStep({ clock, transports });
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		clock.advance(2 * HOUR_MS);
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		const rows = await readEntries(db, ids);
		expect({
			claimed: rows.filter((row) => row.claimedAt !== null).length,
			mails: mails.length,
			pause: await scopePause(db, `connection:${connectionId}`),
			states: sortedStatesOf(rows),
		}).toStrictEqual({
			claimed: 1,
			mails: 1,
			pause: { code: 'resend.quota', until: new Date(START + 3 * HOUR_MS) },
			states: [
				['planned', 0, 'resend.quota'],
				['planned', 0, null],
				['planned', 0, null],
				['planned', 0, null],
			],
		});
	});

	it('probes a paused scope with one entry once the pause ends and lifts it on acceptance', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { clock, db } = harness;
		const { connectionId, first } = await resendSenders(db);
		const ids = await planEntries(db, first, 3);
		const refused = gate(refusal('quota', 'resend.quota'));
		const { mails, transport } = testTransport(refused.answer);
		const step = outboxStep({ clock, transports: new Map([[first, transport]]) });
		const scope = `connection:${connectionId}` as const;
		await runStep(harness, step);
		clock.advance(HOUR_MS);
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		const whileRefused = { mails: mails.length, pause: await scopePause(db, scope) };
		refused.open();
		clock.advance(HOUR_MS);
		await runStep(harness, step);
		expect(whileRefused).toStrictEqual({
			mails: 2,
			pause: { code: 'resend.quota', until: new Date(START + 2 * HOUR_MS) },
		});
		await expect(scopePause(db, scope)).resolves.toBeNull();
		expect(mails).toHaveLength(5);
		expect(statesOf(await readEntries(db, ids))).toStrictEqual(ids.map(() => ['sent', 1, null]));
	});

	it('marks entries stuck in sending for ten minutes as uncertain and never resends them', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { clock, db } = harness;
		const { senderId } = await graphSender(db);
		const [id = ''] = await planEntries(db, senderId, 1, {
			claimedAt: new Date(START),
			messageId: '<stuck@example.org>',
			status: 'sending',
		});
		const { mails, transport } = testTransport();
		const step = outboxStep({ clock, transports: new Map([[senderId, transport]]) });
		clock.advance(10 * MINUTE_MS);
		await runStep(harness, step);
		const atTenMinutes = statesOf([await readEntry(db, id)]);
		clock.advance(1);
		await runStep(harness, step);
		const afterwards = statesOf([await readEntry(db, id)]);
		clock.advance(DAY_MS);
		await runStep(harness, step);
		expect({ afterwards, atTenMinutes }).toStrictEqual({
			afterwards: [['uncertain', 0, 'outbox.interrupted']],
			atTenMinutes: [['sending', 0, null]],
		});
		expect(mails).toHaveLength(0);
	});

	it('marks an unclear send as uncertain at once and never resends it', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const { senderId } = await graphSender(harness.db);
		const ids = await planEntries(harness.db, senderId, 2);
		const answers = [refusal('uncertain', 'graph.timeout'), 'throws'] as const;
		const { mails, transport } = testTransport(inTurn(answers));
		const step = outboxStep({ clock: harness.clock, transports: new Map([[senderId, transport]]) });
		await runStep(harness, step);
		harness.clock.advance(DAY_MS);
		await runStep(harness, step);
		const states = statesOf(await readEntries(harness.db, ids));
		expect(states.map(([status, attempts]) => [status, attempts])).toStrictEqual([
			['uncertain', 1],
			['uncertain', 1],
		]);
		expect(sorted(states.map((state) => state[2]))).toStrictEqual(['graph.timeout', 'outbox.send']);
		expect(mails).toHaveLength(2);
		expect(JSON.stringify(log.mock.calls)).not.toContain('@example.org');
		log.mockRestore();
	});

	it('keeps a state that was set while the mail was on its way', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { db } = harness;
		const warn = vi.spyOn(console, 'warn').mockReturnValue();
		const { senderId } = await graphSender(db);
		const [id = ''] = await planEntries(db, senderId, 1);
		const transport: Transport = {
			fetchBounces: null,
			probe: null,
			async send() {
				// Another run turned the entry uncertain in the meantime.
				await db.update(outboxEntries).set({ status: 'uncertain' }).where(eq(outboxEntries.id, id));
				return OK;
			},
		};
		await runStep(
			harness,
			outboxStep({ clock: harness.clock, transports: new Map([[senderId, transport]]) }),
		);
		expect(statesOf([await readEntry(db, id)])).toStrictEqual([['uncertain', 0, null]]);
		expect(warn).toHaveBeenCalledWith('outbox entry changed while sending', 'sent');
		await expect(quotaToday(db, `sender:${senderId}`, harness.clock.now())).resolves.toMatchObject({
			used: 1,
		});
		warn.mockRestore();
	});

	it('records skip and fail from the preparer', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db);
		const [skipped = '', failed = ''] = await planEntries(harness.db, senderId, 2);
		const preparer = testPreparer(
			new Map<string, PreparedMail>([
				[skipped, { kind: 'skip', reason: 'suppressed' }],
				[failed, { code: 'missing:contact.firstName', kind: 'fail' }],
			]),
		);
		const { mails, transport } = testTransport();
		const transports = new Map([[senderId, transport]]);
		await runStep(harness, outboxStep({ clock: harness.clock, preparer, transports }));
		expect(mails).toHaveLength(0);
		expect(statesOf(await readEntries(harness.db, [skipped, failed]))).toStrictEqual([
			['skipped', 0, 'suppressed'],
			['failed', 0, 'missing:contact.firstName'],
		]);
	});

	it('fails an entry whose source has no preparer', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const { senderId } = await graphSender(harness.db);
		const [id = ''] = await planEntries(harness.db, senderId, 1);
		const { mails, transport } = testTransport();
		const transports = new Map([[senderId, transport]]);
		const step = outboxStep({ clock: harness.clock, preparer: null, transports });
		await expect(runStep(harness, step)).resolves.toStrictEqual({ moreWork: false });
		expect(mails).toHaveLength(0);
		expect(statesOf([await readEntry(harness.db, id)])).toStrictEqual([
			['failed', 0, 'outbox.noSource'],
		]);
	});

	it('retries an entry whose preparer throws', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		const log = vi.spyOn(console, 'error').mockReturnValue();
		const { senderId } = await graphSender(harness.db);
		const [id = ''] = await planEntries(harness.db, senderId, 1);
		const preparer = testPreparer(new Map([[id, 'throws']]));
		const { mails, transport } = testTransport();
		const transports = new Map([[senderId, transport]]);
		await runStep(harness, outboxStep({ clock: harness.clock, preparer, transports }));
		expect(mails).toHaveLength(0);
		await expect(readEntry(harness.db, id)).resolves.toMatchObject({
			attempts: 1,
			lastErrorCode: 'outbox.prepare',
			nextAttemptAt: new Date(START + 5 * MINUTE_MS),
			status: 'planned',
		});
		expect(log).toHaveBeenCalledWith('outbox entry not prepared', 'Error');
		log.mockRestore();
	});

	it('fails planned entries whose sender is gone', async () => {
		const harness = { clock: testClock(), db: await createTestDb() };
		await setUpClub(harness.db);
		const [id = ''] = await planEntries(harness.db, null, 1);
		await runStep(harness, outboxStep({ clock: harness.clock, transports: new Map() }));
		expect(statesOf([await readEntry(harness.db, id)])).toStrictEqual([
			['failed', 0, 'outbox.noSender'],
		]);
	});
});

describe(kickOutbox, () => {
	it('runs the work in the background of the platform', async () => {
		const handed: Promise<unknown>[] = [];
		const platform: Platform = {
			name: 'cloudflare',
			waitUntil(promise) {
				handed.push(promise);
			},
		};
		const run = vi.fn<() => Promise<string>>().mockResolvedValue('done');
		kickOutbox(platform, run);
		expect(() => {
			kickOutbox(platform, throwingRun);
		}).not.toThrow();
		await expect(Promise.allSettled(handed)).resolves.toStrictEqual([
			{ status: 'fulfilled', value: 'done' },
			{ reason: new Error('kaputt'), status: 'rejected' },
		]);
		// Workers keep work after the response for 30 seconds only.
		expect(KICK_BUDGET_MS).toBeLessThan(30 * SECOND_MS);
	});
});
