import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import type { Db } from '@/server/db/client';
import {
	loginLinkDays,
	loginLinkWindow,
	rateLimit,
	session,
	user,
	verification,
} from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';
import type { TickContext } from '@/server/tick/tick';

import { createPruneAuthRecordsStep, pruneAuthRecords } from './prune';

const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 5).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://x@localhost/x',
});

const HOUR_MS = 3_600_000;

function context(db: Db, now: () => Date = () => new Date()): TickContext {
	return { db, deadline: Date.now() + HOUR_MS, env, now, storage: null, subrequests: null };
}

/**
 * Inserts verification rows that expire the given number of seconds from now (negative: expired).
 *
 * @param db The database.
 * @param expiries The expiry offsets in seconds, one row each.
 */
async function insertVerifications(db: Db, expiries: readonly number[]): Promise<void> {
	await db.insert(verification).values(
		expiries.map((seconds, index) => ({
			expiresAt: sql`now() + make_interval(secs => ${seconds})`,
			id: `v${index}`,
			identifier: `id-${index}`,
			value: 'token',
		})),
	);
}

/**
 * Inserts login link windows opened the given number of seconds ago.
 *
 * @param db The database.
 * @param ages The window ages in seconds, one row each.
 */
async function insertWindows(db: Db, ages: readonly number[]): Promise<void> {
	await db.insert(loginLinkWindow).values(
		ages.map((seconds, index) => ({
			emailHash: `h${index}`,
			openedAt: sql`now() - make_interval(secs => ${seconds})`,
		})),
	);
}

/**
 * A clock that is just before the deadline on its first reading and at the deadline after that,
 * so the step deletes exactly one batch.
 *
 * @param deadline The deadline in epoch milliseconds.
 * @returns The clock.
 */
function clockReachingDeadlineAfterOneBatch(deadline: number): () => Date {
	const readings = [deadline - 1];
	return () => new Date(readings.shift() ?? deadline);
}

/**
 * Inserts sessions of one user that expire the given number of seconds from now.
 *
 * @param db The database.
 * @param expiries The expiry offsets in seconds, one session each.
 */
async function insertSessions(db: Db, expiries: readonly number[]): Promise<void> {
	const [owner] = await db
		.insert(user)
		.values({ email: 'anna@verein.de', name: 'Anna' })
		.returning({ id: user.id });
	if (owner === undefined) throw new Error('no user');
	await db.insert(session).values(
		expiries.map((seconds, index) => ({
			expiresAt: sql`now() + make_interval(secs => ${seconds})`,
			id: `s${index}`,
			token: `token-${index}`,
			userId: owner.id,
		})),
	);
}

/**
 * Inserts rate limiter rows whose last request was the given number of seconds ago.
 *
 * @param db The database.
 * @param ages The ages in seconds, one row each.
 */
async function insertRateLimits(db: Db, ages: readonly number[]): Promise<void> {
	await db.insert(rateLimit).values(
		ages.map((seconds, index) => ({
			count: 1,
			id: `r${index}`,
			key: `203.0.113.${index}/sign-in/magic-link`,
			lastRequest: sql`(extract(epoch from now()) * 1000)::bigint - ${seconds * 1000}`,
		})),
	);
}

async function sessionIds(db: Db): Promise<string[]> {
	const rows = await db.select({ id: session.id }).from(session).orderBy(session.id);
	return rows.map((row) => row.id);
}

async function rateLimitIds(db: Db): Promise<string[]> {
	const rows = await db.select({ id: rateLimit.id }).from(rateLimit).orderBy(rateLimit.id);
	return rows.map((row) => row.id);
}

async function verificationIds(db: Db): Promise<string[]> {
	const rows = await db.select({ id: verification.id }).from(verification).orderBy(verification.id);
	return rows.map((row) => row.id);
}

async function windowHashes(db: Db): Promise<string[]> {
	const rows = await db
		.select({ emailHash: loginLinkWindow.emailHash })
		.from(loginLinkWindow)
		.orderBy(loginLinkWindow.emailHash);
	return rows.map((row) => row.emailHash);
}

describe('prune-auth-records', () => {
	it('is named prune-auth-records', () => {
		expect(pruneAuthRecords.name).toBe('prune-auth-records');
	});

	it('deletes expired verification rows and keeps valid ones', async () => {
		const db = await createTestDb();
		await insertVerifications(db, [-60, 600, -1, 3600]);
		await expect(pruneAuthRecords.run(context(db))).resolves.toStrictEqual({ moreWork: false });
		await expect(verificationIds(db)).resolves.toStrictEqual(['v1', 'v3']);
	});

	it('deletes login link windows older than the 60 second window', async () => {
		const db = await createTestDb();
		await insertWindows(db, [61, 10, 3600, 59]);
		await expect(pruneAuthRecords.run(context(db))).resolves.toStrictEqual({ moreWork: false });
		await expect(windowHashes(db)).resolves.toStrictEqual(['h1', 'h3']);
	});

	it('deletes expired sessions and keeps valid ones', async () => {
		const db = await createTestDb();
		await insertSessions(db, [-60, 600, -1, 86_400]);
		await expect(pruneAuthRecords.run(context(db))).resolves.toStrictEqual({ moreWork: false });
		await expect(sessionIds(db)).resolves.toStrictEqual(['s1', 's3']);
	});

	it('deletes rate limiter rows idle for more than twice the longest window', async () => {
		const db = await createTestDb();
		await insertRateLimits(db, [121, 5, 3600, 119]);
		await expect(pruneAuthRecords.run(context(db))).resolves.toStrictEqual({ moreWork: false });
		await expect(rateLimitIds(db)).resolves.toStrictEqual(['r1', 'r3']);
	});

	it('deletes the login link counters of past club days', async () => {
		const db = await createTestDb();
		await db.insert(loginLinkDays).values([
			{ count: 3, day: '2026-11-24', emailHash: 'h0' },
			{ count: 10, day: '2026-11-25', emailHash: 'h1' },
			{ count: 1, day: '2026-11-26', emailHash: 'h1' },
			{ count: 2, day: '2026-11-26', emailHash: 'h2' },
		]);
		// Half past midnight in Berlin: the 26th has begun, while it is still the 25th in UTC.
		const now = new Date('2026-11-25T23:30:00Z');
		const ctx = {
			db,
			deadline: now.getTime() + HOUR_MS,
			env,
			now: () => now,
			storage: null,
			subrequests: null,
		};
		await expect(createPruneAuthRecordsStep(1).run(ctx)).resolves.toStrictEqual({
			moreWork: false,
		});
		await expect(
			db
				.select({ day: loginLinkDays.day, emailHash: loginLinkDays.emailHash })
				.from(loginLinkDays)
				.orderBy(loginLinkDays.emailHash),
		).resolves.toStrictEqual([
			{ day: '2026-11-26', emailHash: 'h1' },
			{ day: '2026-11-26', emailHash: 'h2' },
		]);
	});

	it('deletes in batches until nothing is left', async () => {
		const db = await createTestDb();
		await insertVerifications(db, [-1, -2, -3, -4, -5, 600]);
		await insertWindows(db, [61, 62, 63, 64, 65, 1]);
		await insertSessions(db, [-1, -2, -3, 600]);
		await insertRateLimits(db, [200, 300, 400, 1]);
		const step = createPruneAuthRecordsStep(2);
		await expect(step.run(context(db))).resolves.toStrictEqual({ moreWork: false });
		await expect(verificationIds(db)).resolves.toStrictEqual(['v5']);
		await expect(windowHashes(db)).resolves.toStrictEqual(['h5']);
		await expect(sessionIds(db)).resolves.toStrictEqual(['s3']);
		await expect(rateLimitIds(db)).resolves.toStrictEqual(['r3']);
	});

	it('stops at the deadline and reports more work', async () => {
		const db = await createTestDb();
		await insertVerifications(db, [-1, -2, -3]);
		await insertWindows(db, [61]);
		const deadline = Date.now() + HOUR_MS;
		const ctx = {
			db,
			deadline,
			env,
			now: clockReachingDeadlineAfterOneBatch(deadline),
			storage: null,
			subrequests: null,
		};
		await expect(createPruneAuthRecordsStep(2).run(ctx)).resolves.toStrictEqual({ moreWork: true });
		await expect(verificationIds(db)).resolves.toHaveLength(1);
		await expect(windowHashes(db)).resolves.toHaveLength(1);
	});

	it('finishes the rest in the next run', async () => {
		const db = await createTestDb();
		await insertVerifications(db, [-1, -2, -3]);
		await insertWindows(db, [61]);
		await insertSessions(db, [-1]);
		await insertRateLimits(db, [3600]);
		const deadline = Date.now() + HOUR_MS;
		const step = createPruneAuthRecordsStep(2);
		await step.run({
			db,
			deadline,
			env,
			now: clockReachingDeadlineAfterOneBatch(deadline),
			storage: null,
			subrequests: null,
		});
		await expect(step.run(context(db))).resolves.toStrictEqual({ moreWork: false });
		await expect(verificationIds(db)).resolves.toStrictEqual([]);
		await expect(windowHashes(db)).resolves.toStrictEqual([]);
		await expect(sessionIds(db)).resolves.toStrictEqual([]);
		await expect(rateLimitIds(db)).resolves.toStrictEqual([]);
	});
});
