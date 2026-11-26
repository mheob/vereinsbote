/*
 * The outbox (Design 8): one entry per mail. An entry is taken with one statement (`FOR UPDATE
 * SKIP LOCKED`), so two runs never take the same one; every later write names the status and the
 * time of that take, so a late writer cannot overwrite what another run or a person set since.
 * Nothing is sent twice on purpose: an entry left in `sending` turns `uncertain` and stays so.
 */
import { and, asc, count, desc, eq, gt, isNull, lt, lte, min, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import { SUBREQUEST_LIMIT_CODE } from '@/platform/subrequests';
import type { Db } from '@/server/db/client';
import { mailConnections, outboxEntries, senders, waves } from '@/server/db/schema';
import type { Env } from '@/server/env';
import type { ObjectStorage } from '@/server/storage/storage';

import type { QuotaScope } from './open-transport';
import { inScope } from './quota';
import type { IdempotencyWindow, OutgoingMail, SendResult } from './transport';

type EntryStatus =
	| 'bounced'
	| 'cancelled'
	| 'failed'
	| 'planned'
	| 'sending'
	| 'sent'
	| 'skipped'
	| 'uncertain';
type EntryPriority = 'group' | 'personal';

const FIVE_MINUTES_MS = 300_000;
const HALF_AN_HOUR_MS = 1_800_000;
const TWO_HOURS_MS = 7_200_000;
const EIGHT_HOURS_MS = 28_800_000;

/** Attempts that reached the provider before an entry fails (Design 8.4). */
const MAX_ATTEMPTS = 5;
/** The waits after the first to fourth failed attempt. */
const RETRY_DELAYS_MS = [FIVE_MINUTES_MS, HALF_AN_HOUR_MS, TWO_HOURS_MS, EIGHT_HOURS_MS] as const;
/** An entry `sending` for longer than this turns `uncertain` (Design 8.5). */
const UNCERTAIN_AFTER_MS = 600_000;
/** A provider's `Retry-After` counts up to a day; a longer one is a provider's mistake. */
const MAX_RETRY_AFTER_MS = 86_400_000;
/** The shortest pause of a scope after a quota refusal (ruling R5). */
const QUOTA_PAUSE_MS = 3_600_000;
const WINDOW_MS = 60_000;

/** An entry a run has taken. `messageId` is made at its first take and kept for every retry. */
interface ClaimedEntry {
	readonly id: string;
	readonly source: 'wave';
	readonly sourceId: string;
	readonly senderId: string;
	readonly priority: EntryPriority;
	/** The attempts before this one. */
	readonly attempts: number;
	readonly messageId: string;
}

/**
 * What the source of an entry makes of it: a mail (the outbox sends it to `recipient`, with the
 * entry's Message-ID), a skip (the contact is no longer mailable) or a failure (a value is missing).
 */
type PreparedMail =
	| { kind: 'send'; mail: OutgoingMail; recipient: string }
	| { kind: 'skip'; reason: string }
	| { kind: 'fail'; code: string };

/** What a preparer gets besides the database and the entry. */
interface PrepareContext {
	readonly now: Date;
	readonly storage: ObjectStorage | null;
	readonly env: Env;
}

/** Prepares one entry. */
type PrepareEntry = (
	db: Db,
	entry: Readonly<ClaimedEntry>,
	ctx: Readonly<PrepareContext>,
) => Promise<PreparedMail>;

/** Builds the mail of an entry of one source (4b: the wave). */
interface EntryPreparer {
	readonly prepare: PrepareEntry;
	/**
	 * Starts a run of the outbox: the function prepares the entries of that run and may keep what
	 * they share for its length (a wave's files, read once per run). Without it every entry goes
	 * to `prepare`.
	 */
	readonly startRun?: () => PrepareEntry;
}

/** What becomes of a taken entry. `attempt`: whether it counts as an attempt. */
type EntryOutcome =
	| { kind: 'sent'; providerId: string | null }
	| { kind: 'failed'; code: string; attempt: boolean }
	| { kind: 'skipped'; reason: string }
	| { kind: 'uncertain'; code: string }
	| { kind: 'retry'; code: string; at: Date }
	/** Back to `planned` without an attempt: the provider refused the credentials. */
	| { kind: 'release'; code: string }
	/** Back to `planned` without an attempt, and the scope pauses until `until` (ruling R5). */
	| { kind: 'pause'; code: string; until: Date }
	/** Back to `planned` without an attempt: the request never left (a Worker's subrequests). */
	| { kind: 'requeue'; code: string };

/** A taken entry and the time of the take, which every later write names. */
interface Claim {
	readonly entry: ClaimedEntry;
	readonly claimedAt: Date;
}

/** A sender with due entries, its connection and whether (and why) that is disturbed. */
interface DueSender {
	readonly senderId: string;
	readonly connectionId: string;
	readonly disturbedSince: Date | null;
	readonly disturbedCode: string | null;
}

/**
 * The wait a provider asked for, at most a day.
 *
 * @param retryAfterMs The provider's `Retry-After`, or null.
 * @returns The wait in milliseconds; 0 without one.
 */
function askedWait(retryAfterMs: number | null): number {
	return Math.min(Math.max(0, retryAfterMs ?? 0), MAX_RETRY_AFTER_MS);
}

/**
 * The wait before the next attempt: the fixed delay, or a longer `Retry-After` (at most a day).
 *
 * @param attempts The attempts made, the failed one included.
 * @param retryAfterMs What the provider asked for, or null.
 * @returns The wait in milliseconds, or null when no attempt is left.
 */
function nextAttemptDelay(attempts: number, retryAfterMs: number | null): number | null {
	if (attempts >= MAX_ATTEMPTS) return null;
	const delay = RETRY_DELAYS_MS[Math.max(1, attempts) - 1] ?? EIGHT_HOURS_MS;
	return Math.max(delay, askedWait(retryAfterMs));
}

/**
 * A failed attempt that may be repeated: a retry after its delay, or a failure after the last.
 *
 * @param code The code of the failure.
 * @param at The attempts made (the failed one included), the instant and the provider's wish.
 * @returns The outcome.
 */
function retryOrFail(
	code: string,
	at: Readonly<{ attempts: number; now: Date; retryAfterMs: number | null }>,
): EntryOutcome {
	const delay = nextAttemptDelay(at.attempts, at.retryAfterMs);
	if (delay === null) return { attempt: true, code, kind: 'failed' };
	return { at: new Date(at.now.getTime() + delay), code, kind: 'retry' };
}

/**
 * What a refusal of the provider makes of the entry; see `outcomeOf`.
 *
 * @param result The refusal.
 * @param at The attempts before this one and the instant.
 * @returns The outcome.
 */
function refusalOutcome(
	result: Readonly<Extract<SendResult, { ok: false }>>,
	at: Readonly<{ attempts: number; now: Date }>,
): EntryOutcome {
	const { code, failure, retryAfterMs } = result;
	const { now } = at;
	if (failure === 'uncertain') return { code, kind: 'uncertain' };
	if (failure === 'rejected') return { attempt: true, code, kind: 'failed' };
	if (failure === 'unauthorized') return { code, kind: 'release' };
	if (failure === 'quota') {
		const pause = Math.max(QUOTA_PAUSE_MS, askedWait(retryAfterMs));
		return { code, kind: 'pause', until: new Date(now.getTime() + pause) };
	}
	if (code === SUBREQUEST_LIMIT_CODE) return { code, kind: 'requeue' };
	return retryOrFail(code, { attempts: at.attempts + 1, now, retryAfterMs });
}

/**
 * What a send result makes of the entry (Design 6.3, 8.4 to 8.6; ruling R2: an unclear send is
 * never repeated; ruling R5: a spent quota pauses the scope for at least an hour). A request the
 * platform refused to make (`platform.subrequests`) sent nothing and costs no attempt.
 *
 * @param result What the transport answered.
 * @param at The attempts before this one and the instant.
 * @returns The outcome.
 */
function outcomeOf(
	result: Readonly<SendResult>,
	at: Readonly<{ attempts: number; now: Date }>,
): EntryOutcome {
	if (result.ok) return { kind: 'sent', providerId: result.providerId };
	return refusalOutcome(result, at);
}

/**
 * Ruling R7: a retry is safe only while the provider still keeps the entry's idempotency key. Once
 * the first attempt is older than the key is trusted, a refusal that may have sent the mail makes
 * the entry `uncertain` instead of a retry, as an unclear send does (Design 8.5): only a person
 * sends it again.
 *
 * @param outcome What the answer makes of the entry (`outcomeOf`).
 * @param at The answer, the first attempt of the entry, the instant and the provider's key window
 *   (null for a provider without keys).
 * @returns The outcome, `uncertain` instead of a retry the key no longer protects.
 */
function guardKeyLifetime(
	outcome: Readonly<EntryOutcome>,
	at: Readonly<{
		result: Readonly<SendResult>;
		firstAttemptAt: Date;
		now: Date;
		idempotency: Readonly<IdempotencyWindow> | null;
	}>,
): EntryOutcome {
	const { idempotency, result } = at;
	if (outcome.kind !== 'retry' || idempotency === null || result.ok) return outcome;
	const age = at.now.getTime() - at.firstAttemptAt.getTime();
	if (age <= idempotency.trustedMs || !idempotency.mayHaveSent(result.code)) return outcome;
	return { code: result.code, kind: 'uncertain' };
}

/**
 * Planned entries whose time has come.
 *
 * @param now The instant.
 * @returns The condition.
 */
function isDue(now: Date): SQL | undefined {
	const retryDue = or(isNull(outboxEntries.nextAttemptAt), lte(outboxEntries.nextAttemptAt, now));
	return and(eq(outboxEntries.status, 'planned'), lte(outboxEntries.notBefore, now), retryDue);
}

/**
 * The entry as this run took it: still `sending`, taken at that time.
 *
 * @param claim The take.
 * @returns The condition.
 */
function stillTaken(claim: Readonly<Claim>): SQL | undefined {
	return and(
		eq(outboxEntries.id, claim.entry.id),
		eq(outboxEntries.status, 'sending'),
		eq(outboxEntries.claimedAt, claim.claimedAt),
	);
}

/**
 * Turns entries `sending` for more than ten minutes into `uncertain`: their run broke off, and
 * the mail may have gone. They are never sent again by themselves (Design 8.5).
 *
 * @param db The database.
 * @param now The instant.
 * @returns How many.
 */
async function markUncertain(db: Db, now: Date): Promise<number> {
	const takenBefore = new Date(now.getTime() - UNCERTAIN_AFTER_MS);
	const stuck = or(isNull(outboxEntries.claimedAt), lt(outboxEntries.claimedAt, takenBefore));
	const marked = await db
		.update(outboxEntries)
		.set({ lastErrorCode: 'outbox.interrupted', status: 'uncertain' })
		.where(and(eq(outboxEntries.status, 'sending'), stuck))
		.returning({ id: outboxEntries.id });
	return marked.length;
}

/**
 * Fails planned entries whose sender is gone (deleting a sender with open entries is refused,
 * so only a race leaves one), so that none waits for ever.
 *
 * @param db The database.
 * @returns How many.
 */
async function failOrphans(db: Db): Promise<number> {
	const failed = await db
		.update(outboxEntries)
		.set({ lastErrorCode: 'outbox.noSender', status: 'failed' })
		.where(and(eq(outboxEntries.status, 'planned'), isNull(outboxEntries.senderId)))
		.returning({ id: outboxEntries.id });
	return failed.length;
}

/**
 * The senders with due entries, those with personal mail first.
 *
 * @param db The database.
 * @param now The instant.
 * @returns The senders with their connection.
 */
async function dueSenders(db: Db, now: Date): Promise<DueSender[]> {
	return db
		.select({
			connectionId: senders.connectionId,
			disturbedCode: mailConnections.disturbedCode,
			disturbedSince: mailConnections.disturbedSince,
			senderId: senders.id,
		})
		.from(outboxEntries)
		.innerJoin(senders, eq(senders.id, outboxEntries.senderId))
		.innerJoin(mailConnections, eq(mailConnections.id, senders.connectionId))
		.where(isDue(now))
		.groupBy(senders.id, mailConnections.id)
		.orderBy(desc(sql`bool_or(${outboxEntries.priority} = 'personal')`), asc(senders.id));
}

/**
 * Whether a sender has a due entry.
 *
 * @param db The database.
 * @param input The sender, the instant and whether only personal entries count.
 * @returns True when one is due.
 */
async function hasDueEntry(
	db: Db,
	input: Readonly<{ senderId: string; now: Date; personalOnly: boolean }>,
): Promise<boolean> {
	const [row] = await db
		.select({ id: outboxEntries.id })
		.from(outboxEntries)
		.where(
			and(
				eq(outboxEntries.senderId, input.senderId),
				isDue(input.now),
				input.personalOnly ? eq(outboxEntries.priority, 'personal') : undefined,
			),
		)
		.limit(1);
	return row !== undefined;
}

/**
 * Takes the next due entry of a sender, personal mail first, and gives it its Message-ID on the
 * first take (ruling R4). One statement: the subquery locks one planned row and skips rows other
 * runs hold, the update takes it, so no two runs get the same entry. The subquery is a scalar
 * one (`id = (…)`), which PostgreSQL runs once; within `id in (…)` it may run again for further
 * rows and take more than one.
 *
 * @param db The database.
 * @param input The sender, a fresh Message-ID (kept only on the first take), the instant and
 *   whether only personal entries may start (decision 5).
 * @returns The take, or null when no entry is due.
 */
async function claimEntry(
	db: Db,
	input: Readonly<{ senderId: string; messageId: string; now: Date; personalOnly: boolean }>,
): Promise<Claim | null> {
	const { messageId, now, senderId } = input;
	const next = db
		.select({ id: outboxEntries.id })
		.from(outboxEntries)
		.where(
			and(
				eq(outboxEntries.senderId, senderId),
				isDue(now),
				input.personalOnly ? eq(outboxEntries.priority, 'personal') : undefined,
			),
		)
		.orderBy(
			desc(sql`${outboxEntries.priority} = 'personal'`),
			asc(outboxEntries.notBefore),
			asc(outboxEntries.createdAt),
			asc(outboxEntries.id),
		)
		.limit(1)
		.for('update', { skipLocked: true });
	const [row] = await db
		.update(outboxEntries)
		.set({
			claimedAt: now,
			messageId: sql`coalesce(${outboxEntries.messageId}, ${messageId})`,
			status: 'sending',
		})
		.where(and(sql`${outboxEntries.id} = (${next})`, eq(outboxEntries.status, 'planned')))
		.returning({
			attempts: outboxEntries.attempts,
			id: outboxEntries.id,
			messageId: outboxEntries.messageId,
			priority: outboxEntries.priority,
			source: outboxEntries.source,
			sourceId: outboxEntries.sourceId,
		});
	if (row === undefined) return null;
	return {
		claimedAt: now,
		entry: { ...row, messageId: row.messageId ?? messageId, senderId },
	};
}

/**
 * Stores the address a mail goes to and, on its first attempt, the time of that attempt (the time
 * of the take, a moment earlier), right before it is sent, and checks that the entry is still this
 * run's.
 *
 * @param db The database.
 * @param claim The take.
 * @param recipient The address.
 * @returns When the entry's mail first went to a provider, or null when the entry is no longer
 *   this run's: then nothing may be sent.
 */
async function recordRecipient(
	db: Db,
	claim: Readonly<Claim>,
	recipient: string,
): Promise<Date | null> {
	const [updated] = await db
		.update(outboxEntries)
		.set({
			firstAttemptAt: sql`coalesce(${outboxEntries.firstAttemptAt}, ${claim.claimedAt.toISOString()}::timestamptz)`,
			recipient,
		})
		.where(stillTaken(claim))
		.returning({ firstAttemptAt: outboxEntries.firstAttemptAt });
	return updated?.firstAttemptAt ?? null;
}

const nextAttempt = sql`${outboxEntries.attempts} + 1`;

/**
 * The status of an entry that waits again: `planned`, unless its wave was stopped while its mail
 * was on the way. Then `cancelled`, as the stop cancelled every other planned entry of the wave
 * (Design 11.4): the send that ran finished, no further attempt follows.
 */
const plannedUnlessStopped = sql<
	'cancelled' | 'planned'
>`case when exists (select 1 from ${waves} where ${waves.id} = ${outboxEntries.waveId} and ${waves.stoppedAt} is not null) then 'cancelled' else 'planned' end`;

/**
 * The columns of an outcome that counts as an attempt.
 *
 * @param outcome The outcome.
 * @param now The instant.
 * @returns The changes.
 */
function attemptChanges(
	outcome: Readonly<Extract<EntryOutcome, { kind: 'retry' | 'sent' | 'uncertain' }>>,
	now: Date,
): PgUpdateSetSource<typeof outboxEntries> {
	if (outcome.kind === 'sent') {
		const { providerId } = outcome;
		return { attempts: nextAttempt, lastErrorCode: null, providerId, sentAt: now, status: 'sent' };
	}
	if (outcome.kind === 'retry') {
		const { at, code } = outcome;
		return {
			attempts: nextAttempt,
			lastErrorCode: code,
			nextAttemptAt: at,
			status: plannedUnlessStopped,
		};
	}
	return { attempts: nextAttempt, lastErrorCode: outcome.code, status: 'uncertain' };
}

/**
 * The columns an outcome sets.
 *
 * @param outcome The outcome.
 * @param now The instant.
 * @returns The changes.
 */
function changesOf(
	outcome: Readonly<EntryOutcome>,
	now: Date,
): PgUpdateSetSource<typeof outboxEntries> {
	const { kind } = outcome;
	if (kind === 'sent' || kind === 'retry' || kind === 'uncertain') {
		return attemptChanges(outcome, now);
	}
	if (kind === 'failed') {
		const counted = outcome.attempt ? { attempts: nextAttempt } : {};
		return { ...counted, lastErrorCode: outcome.code, status: 'failed' };
	}
	if (kind === 'skipped') return { lastErrorCode: outcome.reason, status: 'skipped' };
	// `release`, `pause` and `requeue`: the entry waits for its connection, its scope or the next
	// invocation, without an attempt.
	return { lastErrorCode: outcome.code, status: plannedUnlessStopped };
}

/**
 * Stores what became of a taken entry, unless it is no longer this run's (a person or another
 * run changed it in the meantime; their state stays). An entry that would wait again is cancelled
 * when its wave was stopped meanwhile.
 *
 * @param db The database.
 * @param claim The take.
 * @param outcome The outcome.
 * @param now The instant.
 * @returns False when the entry was no longer this run's.
 */
// oxlint-disable-next-line max-params -- the database, the take, the outcome and the instant
async function storeOutcome(
	db: Db,
	claim: Readonly<Claim>,
	outcome: Readonly<EntryOutcome>,
	now: Date,
): Promise<boolean> {
	const updated = await db
		.update(outboxEntries)
		.set(changesOf(outcome, now))
		.where(stillTaken(claim))
		.returning({ id: outboxEntries.id });
	return updated.length > 0;
}

/**
 * The mails of a scope the provider accepted in the last minute, so that a run continues the
 * throttle of the run before it (decision 6).
 *
 * @param db The database.
 * @param scope The scope.
 * @param now The instant.
 * @returns How many, and when the first of them went.
 */
async function recentSends(
	db: Db,
	scope: QuotaScope,
	now: Date,
): Promise<{ count: number; oldest: Date | null }> {
	const windowStart = new Date(now.getTime() - WINDOW_MS);
	const [row] = await db
		.select({ count: count(), oldest: min(outboxEntries.sentAt) })
		.from(outboxEntries)
		.where(and(inScope(scope), gt(outboxEntries.sentAt, windowStart)));
	return { count: row?.count ?? 0, oldest: row?.oldest ?? null };
}

/**
 * Records that the provider refused the credentials of a connection. The first time of a
 * disturbance stays: a later refusal changes only the code.
 *
 * @param db The database.
 * @param connectionId The connection.
 * @param code The code of the refusal.
 * @param since When the disturbance began, if it began before this refusal.
 */
// oxlint-disable-next-line max-params -- the database, the connection, the code and the start
async function disturbConnection(
	db: Db,
	connectionId: string,
	code: string,
	since: Date,
): Promise<void> {
	await db
		.update(mailConnections)
		.set({
			disturbedCode: code,
			disturbedSince: sql`coalesce(${mailConnections.disturbedSince}, ${since.toISOString()}::timestamptz)`,
		})
		.where(eq(mailConnections.id, connectionId));
}

/**
 * Ends the disturbance of a connection: the provider took its credentials (or its mails) again.
 * Only the disturbance the caller read is cleared: another run (a kick and a tick, the system
 * mailer) may have recorded a newer one meanwhile, with another code or after this one ended, and
 * that one stays.
 *
 * @param db The database.
 * @param connectionId The connection.
 * @param read The disturbance as the caller read it: its code and its start.
 * @param read.code The code of the refusal.
 * @param read.since When the disturbance began.
 */
async function clearDisturbance(
	db: Db,
	connectionId: string,
	read: Readonly<{ code: string | null; since: Date }>,
): Promise<void> {
	await db
		.update(mailConnections)
		.set({ disturbedCode: null, disturbedSince: null })
		.where(
			and(
				eq(mailConnections.id, connectionId),
				read.code === null
					? isNull(mailConnections.disturbedCode)
					: eq(mailConnections.disturbedCode, read.code),
				eq(mailConnections.disturbedSince, read.since),
			),
		);
}

export {
	MAX_ATTEMPTS,
	RETRY_DELAYS_MS,
	UNCERTAIN_AFTER_MS,
	askedWait,
	claimEntry,
	clearDisturbance,
	disturbConnection,
	dueSenders,
	failOrphans,
	guardKeyLifetime,
	hasDueEntry,
	markUncertain,
	nextAttemptDelay,
	outcomeOf,
	recentSends,
	recordRecipient,
	retryOrFail,
	storeOutcome,
};
export type {
	Claim,
	ClaimedEntry,
	DueSender,
	EntryOutcome,
	EntryPreparer,
	EntryPriority,
	EntryStatus,
	PrepareContext,
	PrepareEntry,
	PreparedMail,
};
