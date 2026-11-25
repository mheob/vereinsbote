import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { setUpClub } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { outboxEntries, senders } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import { countSent, estimateDays, mayStart, quotaToday, startOfNextClubDay } from './quota';
import { graphConnection, resendConnection, senderOn } from './testing';

const WAVE_ID = '00000000-0000-4000-8000-0000000000aa';
/** 10:00 in Berlin. */
const NOW = new Date('2026-11-25T09:00:00.000Z');
const HOUR_MS = 3_600_000;

/**
 * A Graph sender with a daily limit.
 *
 * @param db The test database.
 * @param dailyLimit The limit.
 * @returns The quota scope of the sender.
 */
async function limitedGraphSender(db: Db, dailyLimit: number): Promise<`sender:${string}`> {
	const { admin } = await setUpClub(db);
	const connectionId = await graphConnection(db, admin);
	const senderId = await senderOn(db, admin, connectionId, 'verein@example.org');
	await db.update(senders).set({ dailyLimit }).where(eq(senders.id, senderId));
	return `sender:${senderId}`;
}

/**
 * Plans an entry.
 *
 * @param db The test database.
 * @param values The sender, the priority and what else differs.
 */
async function planEntry(
	db: Db,
	values: Readonly<Partial<typeof outboxEntries.$inferInsert>> &
		Readonly<Pick<typeof outboxEntries.$inferInsert, 'priority' | 'senderId'>>,
): Promise<void> {
	await db
		.insert(outboxEntries)
		.values({ notBefore: NOW, source: 'wave', sourceId: WAVE_ID, ...values });
}

describe(quotaToday, () => {
	it('counts per scope and club day', async () => {
		const db = await createTestDb();
		const scope = await limitedGraphSender(db, 50);
		// 23:59 and 00:01 in Berlin (UTC+1 in November).
		const beforeMidnight = new Date('2026-11-25T22:59:00.000Z');
		const afterMidnight = new Date('2026-11-25T23:01:00.000Z');
		await countSent(db, scope, beforeMidnight);
		await countSent(db, scope, beforeMidnight);
		await countSent(db, scope, afterMidnight);
		await countSent(db, 'connection:00000000-0000-4000-8000-000000000001', beforeMidnight);
		await expect(quotaToday(db, scope, beforeMidnight)).resolves.toStrictEqual({
			limit: 50,
			reserved: 0,
			used: 2,
		});
		await expect(quotaToday(db, scope, afterMidnight)).resolves.toStrictEqual({
			limit: 50,
			reserved: 0,
			used: 1,
		});
	});

	it.each([
		// Spring forward: the 28th of March 2027 has 23 hours, from 23:00 UTC to 22:00 UTC.
		['2027-03-27T22:59:00.000Z', '2027-03-27T23:01:00.000Z', '2027-03-27T23:00:00.000Z'],
		['2027-03-28T21:59:00.000Z', '2027-03-28T22:01:00.000Z', '2027-03-28T22:00:00.000Z'],
		// Fall back: the 31st of October 2027 has 25 hours, from 22:00 UTC to 23:00 UTC.
		['2027-10-30T21:59:00.000Z', '2027-10-30T22:01:00.000Z', '2027-10-30T22:00:00.000Z'],
		['2027-10-31T22:59:00.000Z', '2027-10-31T23:01:00.000Z', '2027-10-31T23:00:00.000Z'],
	])(
		'starts a new day correctly in the night of the clock change (%s)',
		async (lastMinute, firstMinute, dayStart) => {
			const db = await createTestDb();
			const scope = await limitedGraphSender(db, 10);
			await countSent(db, scope, new Date(lastMinute));
			await countSent(db, scope, new Date(firstMinute));
			await expect(quotaToday(db, scope, new Date(lastMinute))).resolves.toMatchObject({
				used: 1,
			});
			await expect(quotaToday(db, scope, new Date(firstMinute))).resolves.toMatchObject({
				used: 1,
			});
			expect(startOfNextClubDay(new Date(lastMinute))).toStrictEqual(new Date(dayStart));
		},
	);

	it('finds the start of the next club day within the hour the clock jumps', () => {
		// 03:30 summer time on the 28th of March, then 02:30 summer and winter time on the 31st of October.
		expect(startOfNextClubDay(new Date('2027-03-28T01:30:00.000Z'))).toStrictEqual(
			new Date('2027-03-28T22:00:00.000Z'),
		);
		expect(startOfNextClubDay(new Date('2027-10-31T00:30:00.000Z'))).toStrictEqual(
			new Date('2027-10-31T23:00:00.000Z'),
		);
		expect(startOfNextClubDay(new Date('2027-10-31T01:30:00.000Z'))).toStrictEqual(
			new Date('2027-10-31T23:00:00.000Z'),
		);
		expect(startOfNextClubDay(new Date('2026-12-31T23:30:00.000Z'))).toStrictEqual(
			new Date('2027-01-01T23:00:00.000Z'),
		);
	});

	it('reserves capacity for personal mail due today', async () => {
		expect(mayStart({ limit: 10, reserved: 4, used: 6 }, 'group')).toBe(false);
		expect(mayStart({ limit: 10, reserved: 4, used: 6 }, 'personal')).toBe(true);
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const resendId = await resendConnection(db, admin);
		const first = await senderOn(db, admin, resendId, 'a@example.org');
		const second = await senderOn(db, admin, resendId, 'b@example.org');
		const graphSender = await senderOn(
			db,
			admin,
			await graphConnection(db, admin),
			'g@example.org',
		);
		const tomorrow = startOfNextClubDay(NOW);
		// Counted: overdue, due now, due later today, on another sender of the same connection.
		await planEntry(db, {
			notBefore: new Date(NOW.getTime() - 24 * HOUR_MS),
			priority: 'personal',
			senderId: first,
		});
		await planEntry(db, { priority: 'personal', senderId: first });
		await planEntry(db, {
			notBefore: new Date(tomorrow.getTime() - 1),
			priority: 'personal',
			senderId: second,
		});
		// Not counted: tomorrow, a retry tomorrow, a group mail, a sent mail, another scope.
		await planEntry(db, { notBefore: tomorrow, priority: 'personal', senderId: first });
		await planEntry(db, { nextAttemptAt: tomorrow, priority: 'personal', senderId: first });
		await planEntry(db, { priority: 'group', senderId: first });
		await planEntry(db, { priority: 'personal', senderId: first, status: 'sent' });
		await planEntry(db, { priority: 'personal', senderId: graphSender });
		await expect(quotaToday(db, `connection:${resendId}`, NOW)).resolves.toStrictEqual({
			limit: 100,
			reserved: 3,
			used: 0,
		});
		await expect(quotaToday(db, `sender:${graphSender}`, NOW)).resolves.toStrictEqual({
			limit: null,
			reserved: 1,
			used: 0,
		});
	});
});

describe(mayStart, () => {
	it.each([
		['personal', { limit: 10, reserved: 0, used: 9 }, true],
		['personal', { limit: 10, reserved: 0, used: 10 }, false],
		['group', { limit: 10, reserved: 3, used: 6 }, true],
		['group', { limit: 10, reserved: 4, used: 6 }, false],
		['group', { limit: null, reserved: 99, used: 99 }, true],
	] as const)('lets %s mail start at %o: %s', (priority, state, expected) => {
		expect(mayStart(state, priority)).toBe(expected);
	});
});

describe(estimateDays, () => {
	it('estimates the days of a wave', () => {
		expect(estimateDays({ limit: 100, mails: 250, reservedPerDay: 20, usedToday: 0 })).toBe(4);
	});

	it.each([
		// 5 today, then 80 a day.
		[{ limit: 100, mails: 250, reservedPerDay: 20, usedToday: 75 }, 5],
		[{ limit: 100, mails: 80, reservedPerDay: 20, usedToday: 0 }, 1],
		[{ limit: 100, mails: 81, reservedPerDay: 20, usedToday: 0 }, 2],
		// Nothing goes today: the wave ends tomorrow, the second day.
		[{ limit: 100, mails: 1, reservedPerDay: 0, usedToday: 100 }, 2],
		[{ limit: null, mails: 250, reservedPerDay: 20, usedToday: 0 }, 1],
		[{ limit: 100, mails: 0, reservedPerDay: 20, usedToday: 0 }, 0],
		// The reserve takes the whole limit: group mails never go.
		[{ limit: 20, mails: 1, reservedPerDay: 20, usedToday: 0 }, Number.POSITIVE_INFINITY],
	] as const)('estimates %o as %s days', (input, days) => {
		expect(estimateDays(input)).toBe(days);
	});
});
