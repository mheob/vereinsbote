/*
 * The daily limits of the senders (Design 8.3, decisions 4 and 5). A Graph sender counts alone, a
 * Resend connection counts for all its senders (`QuotaScope`). The day is the club's calendar day
 * in Europe/Berlin. Personal mails due today keep a reserve that group mails may not use.
 */
import { and, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { CLUB_TIME_ZONE, todayInClubZone } from '@/server/contacts/calendar';
import type { Db } from '@/server/db/client';
import { mailConnections, outboxEntries, sendQuotaDays, senders } from '@/server/db/schema';

import type { QuotaScope } from './open-transport';
import type { EntryPriority } from './outbox';

/** Today's count, the limit (null: none) and the reserve of personal mails still due today. */
interface QuotaState {
	used: number;
	limit: number | null;
	reserved: number;
}

const SENDER_PREFIX = 'sender:';
const CONNECTION_PREFIX = 'connection:';
const MS_PER_SECOND = 1000;

const clubParts = new Intl.DateTimeFormat('en-US', {
	day: 'numeric',
	hour: 'numeric',
	hourCycle: 'h23',
	minute: 'numeric',
	month: 'numeric',
	second: 'numeric',
	timeZone: CLUB_TIME_ZONE,
	year: 'numeric',
});

/**
 * How far the club's clock is ahead of UTC at an instant.
 *
 * @param at The instant.
 * @returns The offset in milliseconds (one or two hours in Berlin).
 */
function clubOffsetMs(at: Date): number {
	const parts = new Map(clubParts.formatToParts(at).map((part) => [part.type, Number(part.value)]));
	const wall = Date.UTC(
		parts.get('year') ?? 0,
		(parts.get('month') ?? 1) - 1,
		parts.get('day') ?? 1,
		parts.get('hour') ?? 0,
		parts.get('minute') ?? 0,
		parts.get('second') ?? 0,
	);
	return wall - Math.floor(at.getTime() / MS_PER_SECOND) * MS_PER_SECOND;
}

/**
 * The instant the next club day begins: midnight in Europe/Berlin, 23 or 25 hours after the last
 * one in the nights the clocks change.
 *
 * @param now The instant.
 * @returns The start of the next day.
 */
function startOfNextClubDay(now: Date): Date {
	const [year = 0, month = 1, day = 1] = todayInClubZone(now).split('-').map(Number);
	// The wall time of the next midnight read as UTC; the zone's offset at that point moves it.
	const wallMidnight = Date.UTC(year, month - 1, day + 1);
	const guess = wallMidnight - clubOffsetMs(new Date(wallMidnight));
	return new Date(wallMidnight - clubOffsetMs(new Date(guess)));
}

/**
 * The outbox entries of a scope: those of the sender, or those of every sender of the connection.
 *
 * @param scope The scope.
 * @returns The condition on `outbox_entries`.
 */
function inScope(scope: QuotaScope): SQL {
	if (scope.startsWith(SENDER_PREFIX)) {
		return eq(outboxEntries.senderId, scope.slice(SENDER_PREFIX.length));
	}
	const connectionId = scope.slice(CONNECTION_PREFIX.length);
	return sql`${outboxEntries.senderId} in (select ${senders.id} from ${senders} where ${senders.connectionId} = ${connectionId})`;
}

/**
 * The daily limit of a scope.
 *
 * @param db The database.
 * @param scope The scope.
 * @returns The limit, or null without one (or when the sender or connection is gone).
 */
async function dailyLimitOf(db: Db, scope: QuotaScope): Promise<number | null> {
	if (scope.startsWith(SENDER_PREFIX)) {
		const [row] = await db
			.select({ limit: senders.dailyLimit })
			.from(senders)
			.where(eq(senders.id, scope.slice(SENDER_PREFIX.length)));
		return row?.limit ?? null;
	}
	const [row] = await db
		.select({ limit: mailConnections.dailyLimit })
		.from(mailConnections)
		.where(eq(mailConnections.id, scope.slice(CONNECTION_PREFIX.length)));
	return row?.limit ?? null;
}

/**
 * The reserve (decision 5): personal entries of the scope, planned, due before the next club day
 * begins, overdue ones included. A retry that waits until tomorrow is not due today.
 *
 * @param db The database.
 * @param scope The scope.
 * @param now The instant.
 * @returns How many.
 */
async function reservedToday(db: Db, scope: QuotaScope, now: Date): Promise<number> {
	const nextDay = startOfNextClubDay(now);
	const retryToday = or(
		isNull(outboxEntries.nextAttemptAt),
		lt(outboxEntries.nextAttemptAt, nextDay),
	);
	const [row] = await db
		.select({ reserved: count() })
		.from(outboxEntries)
		.where(
			and(
				inScope(scope),
				eq(outboxEntries.status, 'planned'),
				eq(outboxEntries.priority, 'personal'),
				lt(outboxEntries.notBefore, nextDay),
				retryToday,
			),
		);
	return row?.reserved ?? 0;
}

/**
 * Where a scope stands today. The queries run one after another, so the function may run inside a
 * transaction as well.
 *
 * @param db The database.
 * @param scope The scope.
 * @param now The instant; its club day counts.
 * @returns The count, the limit and the reserve.
 */
async function quotaToday(db: Db, scope: QuotaScope, now: Date): Promise<QuotaState> {
	const day = todayInClubZone(now);
	const [row] = await db
		.select({ used: sendQuotaDays.count })
		.from(sendQuotaDays)
		.where(and(eq(sendQuotaDays.scope, scope), eq(sendQuotaDays.day, day)));
	const limit = await dailyLimitOf(db, scope);
	const reserved = await reservedToday(db, scope, now);
	return { limit, reserved, used: row?.used ?? 0 };
}

/**
 * Whether a mail of the priority may start now. Personal mails go until the limit is reached,
 * group mails only while the reserve stays free (decision 5).
 *
 * @param state Where the scope stands.
 * @param priority The priority of the mail.
 * @returns True when it may go.
 */
function mayStart(state: Readonly<QuotaState>, priority: EntryPriority): boolean {
	if (state.limit === null) return true;
	if (priority === 'personal') return state.used < state.limit;
	return state.used + state.reserved < state.limit;
}

/**
 * Counts a mail the provider accepted, against today's club day.
 *
 * @param db The database.
 * @param scope The scope.
 * @param now The instant.
 */
async function countSent(db: Db, scope: QuotaScope, now: Date): Promise<void> {
	await db
		.insert(sendQuotaDays)
		.values({ count: 1, day: todayInClubZone(now), scope })
		.onConflictDoUpdate({
			set: { count: sql`${sendQuotaDays.count} + 1` },
			target: [sendQuotaDays.scope, sendQuotaDays.day],
		});
}

/**
 * How many club days a wave takes, counting today as the first: today the room the count and
 * the reserve leave, then the limit less the reserve each day.
 *
 * @param input The mails of the wave, the limit, today's count and the reserve a day (0 for a
 *   personal wave, which the reserve does not hold back).
 * @returns The days; 0 without mails, 1 without a limit, infinite when the reserve leaves no room.
 */
function estimateDays(
	input: Readonly<{
		mails: number;
		limit: number | null;
		usedToday: number;
		reservedPerDay: number;
	}>,
): number {
	const { limit, mails, reservedPerDay, usedToday } = input;
	if (mails <= 0) return 0;
	if (limit === null) return 1;
	const today = Math.max(0, limit - usedToday - reservedPerDay);
	if (today >= mails) return 1;
	const perDay = limit - reservedPerDay;
	if (perDay <= 0) return Number.POSITIVE_INFINITY;
	return 1 + Math.ceil((mails - today) / perDay);
}

export { countSent, estimateDays, inScope, mayStart, quotaToday, startOfNextClubDay };
export type { QuotaState };
