/*
 * The limit of test mails (Design 10.4): at most `TEST_MAILS_PER_HOUR` per user in a rolling hour,
 * counted by the user's `wave.test_sent` entries in the activity log. A test mail claims its entry
 * before it goes out: the claim locks the user's row, counts and writes in one short transaction,
 * so two test mails at once cannot both take the last one of the hour. A test mail the provider
 * did not take gives its entry back.
 */
import { and, count, eq, gt } from 'drizzle-orm';

import type { AuditAction } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { auditLog, user } from '@/server/db/schema';

import { TEST_MAILS_PER_HOUR } from './test-mail-limit';

const HOUR_MS = 3_600_000;

const TEST_SENT: AuditAction = 'wave.test_sent';

/** What a claimed test mail writes into the activity log; never an address. */
interface TestMailClaim {
	readonly userId: string;
	readonly occasionId: string;
	readonly attachments: number;
	readonly now: Date;
}

/**
 * How many test mails a user sent in the hour before an instant.
 *
 * @param db The database or a transaction.
 * @param userId The user.
 * @param now The instant; an entry exactly an hour old no longer counts.
 * @returns The number.
 */
async function testMailsOfHour(db: Db, userId: string, now: Date): Promise<number> {
	const since = new Date(now.getTime() - HOUR_MS);
	const [row] = await db
		.select({ mails: count() })
		.from(auditLog)
		.where(
			and(eq(auditLog.actorUserId, userId), eq(auditLog.action, TEST_SENT), gt(auditLog.at, since)),
		);
	return row?.mails ?? 0;
}

/**
 * Whether a user has a test mail of the hour left. A quick look without a claim: the claim checks
 * again before the mail goes out.
 *
 * @param db The database.
 * @param userId The user.
 * @param now The instant.
 * @returns True while the user sent fewer than `TEST_MAILS_PER_HOUR` in the last hour.
 */
async function hasTestMailLeft(db: Db, userId: string, now: Date): Promise<boolean> {
	return (await testMailsOfHour(db, userId, now)) < TEST_MAILS_PER_HOUR;
}

/**
 * Claims a test mail of the hour: writes its entry into the activity log unless the user has none
 * left. The user's row is locked for the count and the write (`for no key update`, which leaves
 * the user's sessions alone), so concurrent claims of one user take turns.
 *
 * @param db The database.
 * @param claim The user, the occasion, the number of files and the instant.
 * @returns The id of the entry, or null when the user has no test mail left.
 */
async function claimTestMail(db: Db, claim: Readonly<TestMailClaim>): Promise<number | null> {
	const { attachments, now, occasionId, userId } = claim;
	return db.transaction(async (tx) => {
		await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('no key update');
		if ((await testMailsOfHour(tx, userId, now)) >= TEST_MAILS_PER_HOUR) return null;
		const [row] = await tx
			.insert(auditLog)
			.values({
				action: TEST_SENT,
				actorUserId: userId,
				at: now,
				details: { attachments },
				target: `occasion:${occasionId}`,
			})
			.returning({ id: auditLog.id });
		return row?.id ?? null;
	});
}

/**
 * Gives a claimed test mail back: the provider did not take it.
 *
 * @param db The database.
 * @param entryId The entry `claimTestMail` wrote.
 */
async function giveBackTestMail(db: Db, entryId: number): Promise<void> {
	await db.delete(auditLog).where(eq(auditLog.id, entryId));
}

export { claimTestMail, giveBackTestMail, hasTestMailLeft };
export type { TestMailClaim };
