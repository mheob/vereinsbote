/*
 * The limit of test mails (Design 10.4, ruling R20): at most `TEST_MAILS_PER_HOUR` per user in a
 * rolling hour, counted by the user's rows in `test_mail_claims`. A test mail claims its row before
 * it goes out: the claim locks the user's row, counts and inserts in one short transaction, so two
 * test mails at once cannot both take the last one of the hour. A test mail the provider did not
 * take gives its claim back by deleting the row. The activity log is never the counter: it gets
 * `wave.test_sent` only once a mail went out (or may have), and nothing deletes from it.
 */
import { and, count, eq, gt } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { testMailClaims, user } from '@/server/db/schema';

import { TEST_MAILS_PER_HOUR } from './test-mail-limit';

const HOUR_MS = 3_600_000;

/** A test mail a user claims. */
interface TestMailClaim {
	readonly userId: string;
	readonly occasionId: string;
	readonly now: Date;
}

/** What the activity log keeps of a test mail that went out (or may have); never an address. */
interface SentTestMail extends TestMailClaim {
	readonly attachments: number;
	/** The provider's answer was unclear: the mail may have arrived. */
	readonly uncertain: boolean;
}

/**
 * How many test mails a user claimed in the hour before an instant.
 *
 * @param db The database or a transaction.
 * @param userId The user.
 * @param now The instant; a claim exactly an hour old no longer counts.
 * @returns The number.
 */
async function testMailsOfHour(db: Db, userId: string, now: Date): Promise<number> {
	const since = new Date(now.getTime() - HOUR_MS);
	const [row] = await db
		.select({ mails: count() })
		.from(testMailClaims)
		.where(and(eq(testMailClaims.userId, userId), gt(testMailClaims.at, since)));
	return row?.mails ?? 0;
}

/**
 * Whether a user has a test mail of the hour left. A quick look without a claim: the claim checks
 * again before the mail goes out.
 *
 * @param db The database.
 * @param userId The user.
 * @param now The instant.
 * @returns True while the user claimed fewer than `TEST_MAILS_PER_HOUR` in the last hour.
 */
async function hasTestMailLeft(db: Db, userId: string, now: Date): Promise<boolean> {
	return (await testMailsOfHour(db, userId, now)) < TEST_MAILS_PER_HOUR;
}

/**
 * Claims a test mail of the hour unless the user has none left. The user's row is locked for the
 * count and the insert (`for no key update`, which leaves the user's sessions alone), so concurrent
 * claims of one user take turns.
 *
 * @param db The database.
 * @param claim The user, the occasion and the instant.
 * @returns The id of the claim, or null when the user has no test mail left.
 */
async function claimTestMail(db: Db, claim: Readonly<TestMailClaim>): Promise<string | null> {
	const { now, occasionId, userId } = claim;
	return db.transaction(async (tx) => {
		await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('no key update');
		if ((await testMailsOfHour(tx, userId, now)) >= TEST_MAILS_PER_HOUR) return null;
		const [row] = await tx
			.insert(testMailClaims)
			.values({ at: now, occasionId, userId })
			.returning({ id: testMailClaims.id });
		return row?.id ?? null;
	});
}

/**
 * Gives a claimed test mail back: the provider did not take it.
 *
 * @param db The database.
 * @param claimId The claim `claimTestMail` made.
 */
async function giveBackTestMail(db: Db, claimId: string): Promise<void> {
	await db.delete(testMailClaims).where(eq(testMailClaims.id, claimId));
}

/**
 * Logs a test mail the provider took, or whose answer was unclear (`{ outcome: 'uncertain' }`).
 *
 * @param db The database.
 * @param sent The user, the occasion, the instant, the number of files and the outcome.
 */
async function logTestMail(db: Db, sent: Readonly<SentTestMail>): Promise<void> {
	const { attachments, now, occasionId, uncertain, userId } = sent;
	await writeAudit(db, {
		action: 'wave.test_sent',
		actorUserId: userId,
		at: now,
		details: uncertain ? { attachments, outcome: 'uncertain' } : { attachments },
		target: `occasion:${occasionId}`,
	});
}

export { claimTestMail, giveBackTestMail, hasTestMailLeft, logTestMail };
export type { SentTestMail, TestMailClaim };
