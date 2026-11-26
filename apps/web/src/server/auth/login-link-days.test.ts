import { describe, expect, it } from 'vite-plus/test';

import type { Db } from '@/server/db/client';
import { loginLinkDays } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import { LOGIN_LINKS_PER_DAY, skipLoginLinkOfDay, takeLoginLinkOfDay } from './login-link-days';

const ANNA = 'hash-of-anna';
const KIM = 'hash-of-kim';
/** 23:59:59 in Berlin (CET). */
const LATE_EVENING = new Date('2026-11-25T22:59:59Z');
/** Midnight in Berlin: the next club day. */
const MIDNIGHT = new Date('2026-11-25T23:00:00Z');

/**
 * Takes login links one after the other.
 *
 * @param db The database.
 * @param emailHash The key of the address.
 * @param times How many.
 * @param now The instant.
 * @returns The result of each.
 */
// oxlint-disable-next-line max-params -- a test helper with the plain parts of a request
async function takeTimes(db: Db, emailHash: string, times: number, now: Date): Promise<boolean[]> {
	const results: boolean[] = [];
	for (let time = 1; time <= times; time += 1) {
		// oxlint-disable-next-line no-await-in-loop -- the requests count one after the other
		results.push(await takeLoginLinkOfDay(db, emailHash, now));
	}
	return results;
}

describe(takeLoginLinkOfDay, () => {
	it('allows ten login links per address and club day and refuses the eleventh', async () => {
		const db = await createTestDb();
		expect(LOGIN_LINKS_PER_DAY).toBe(10);
		const results = await takeTimes(db, ANNA, 11, LATE_EVENING);
		expect(results).toStrictEqual([...Array.from({ length: 10 }, () => true), false]);
		await expect(db.select().from(loginLinkDays)).resolves.toStrictEqual([
			{ count: 10, day: '2026-11-25', emailHash: ANNA },
		]);
	});

	it('starts over when the club day changes at midnight in Berlin', async () => {
		const db = await createTestDb();
		await takeTimes(db, ANNA, 10, LATE_EVENING);
		await expect(takeLoginLinkOfDay(db, ANNA, LATE_EVENING)).resolves.toBe(false);
		await expect(takeLoginLinkOfDay(db, ANNA, MIDNIGHT)).resolves.toBe(true);
	});

	it('counts each address on its own', async () => {
		const db = await createTestDb();
		await takeTimes(db, ANNA, 10, LATE_EVENING);
		await expect(takeLoginLinkOfDay(db, KIM, LATE_EVENING)).resolves.toBe(true);
	});

	it('never counts past the limit when requests come at once', async () => {
		const db = await createTestDb();
		const results = await Promise.all(
			Array.from({ length: 15 }, async () => takeLoginLinkOfDay(db, ANNA, LATE_EVENING)),
		);
		expect(results.filter(Boolean)).toHaveLength(10);
		await expect(
			db.select({ count: loginLinkDays.count }).from(loginLinkDays),
		).resolves.toStrictEqual([{ count: 10 }]);
	});
});

describe(skipLoginLinkOfDay, () => {
	it('runs the statement of a taken link and counts nothing', async () => {
		const queries: string[] = [];
		const db = await createTestDb({
			logQuery(query) {
				queries.push(query);
			},
		});
		await takeLoginLinkOfDay(db, ANNA, LATE_EVENING);
		const taken = queries.splice(0);
		await skipLoginLinkOfDay(db, ANNA, LATE_EVENING);
		await skipLoginLinkOfDay(db, KIM, LATE_EVENING);
		expect(queries).toStrictEqual([...taken, ...taken]);
		await expect(
			db
				.select({ count: loginLinkDays.count, emailHash: loginLinkDays.emailHash })
				.from(loginLinkDays),
		).resolves.toStrictEqual(
			expect.arrayContaining([
				{ count: 1, emailHash: ANNA },
				{ count: 0, emailHash: KIM },
			]),
		);
		// The skipped requests left the day's links to the address.
		const results = await takeTimes(db, ANNA, 10, LATE_EVENING);
		expect(results.filter(Boolean)).toHaveLength(9);
	});
});
