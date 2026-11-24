import { setTimeout as sleep } from 'node:timers/promises';

import { sql } from 'drizzle-orm';

import type { Db } from './client';

/*
 * Helpers of the tests that run on PostgreSQL (`*.postgres.test.ts`). For tests only.
 */

const WAIT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 20;

/**
 * Waits until the given number of connections of this database wait for a lock.
 *
 * @param db The database.
 * @param count How many must wait.
 * @throws {Error} When fewer connections wait after 10 seconds.
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

export { waitForLockWaiters };
