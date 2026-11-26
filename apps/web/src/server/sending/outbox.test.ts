import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { setUpClub } from '@/server/contacts/testing';
import { mailConnections, outboxEntries } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import {
	MAX_ATTEMPTS,
	RETRY_DELAYS_MS,
	UNCERTAIN_AFTER_MS,
	clearDisturbance,
	disturbConnection,
	guardKeyLifetime,
	keyOutlived,
	markUncertain,
	nextAttemptDelay,
	outcomeOf,
} from './outbox';
import type { EntryOutcome } from './outbox';
import { graphConnection, senderOn } from './testing';
import type { SendFailureClass, SendResult } from './transport';

const WAVE_ID = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-11-25T09:00:00.000Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

describe(nextAttemptDelay, () => {
	it.each([
		[1, 300_000],
		[2, 1_800_000],
		[3, 7_200_000],
		[4, 28_800_000],
		[5, null],
		[6, null],
	])('waits after attempt %i for %s ms', (attempts, delay) => {
		expect(nextAttemptDelay(attempts, null)).toBe(delay);
	});

	it('waits for Retry-After when it is longer, at most a day', () => {
		expect(nextAttemptDelay(1, 600_000)).toBe(600_000);
		expect(nextAttemptDelay(1, MINUTE_MS)).toBe(RETRY_DELAYS_MS[0]);
		expect(nextAttemptDelay(4, 3 * DAY_MS)).toBe(DAY_MS);
		expect(nextAttemptDelay(MAX_ATTEMPTS, 600_000)).toBeNull();
	});
});

/**
 * A refusal of the provider.
 *
 * @param failure The class.
 * @returns The result.
 */
function refused(failure: SendFailureClass): SendResult {
	return { code: 'x.code', failure, ok: false, retryAfterMs: null };
}

describe(outcomeOf, () => {
	const at = { attempts: 0, now: NOW };

	it.each([
		[{ ok: true, providerId: 'p-1' }, 0, { kind: 'sent', providerId: 'p-1' }],
		[refused('uncertain'), 0, { code: 'x.code', kind: 'uncertain' }],
		[refused('rejected'), 0, { attempt: true, code: 'x.code', kind: 'failed' }],
		[refused('unauthorized'), 0, { code: 'x.code', kind: 'release' }],
		[
			refused('quota'),
			0,
			{ code: 'x.code', kind: 'pause', until: new Date(NOW.getTime() + HOUR_MS) },
		],
		[
			{ ...refused('quota'), retryAfterMs: 3 * HOUR_MS },
			0,
			{ code: 'x.code', kind: 'pause', until: new Date(NOW.getTime() + 3 * HOUR_MS) },
		],
		[
			{ ...refused('quota'), retryAfterMs: 3 * DAY_MS },
			0,
			{ code: 'x.code', kind: 'pause', until: new Date(NOW.getTime() + DAY_MS) },
		],
		[
			refused('transient'),
			0,
			{ at: new Date(NOW.getTime() + RETRY_DELAYS_MS[0]), code: 'x.code', kind: 'retry' },
		],
		[refused('transient'), MAX_ATTEMPTS - 1, { attempt: true, code: 'x.code', kind: 'failed' }],
	] as const)('turns %o after %i attempts into %o', (result, attempts, outcome) => {
		expect(outcomeOf(result, { ...at, attempts })).toStrictEqual(outcome);
	});
});

describe(keyOutlived, () => {
	const trustedMs = 23 * HOUR_MS;
	const sentAt = new Date(NOW.getTime() - trustedMs);

	it('lets an entry go while the key of its first counted attempt is trusted', () => {
		expect(keyOutlived({ attempts: 2, firstAttemptAt: sentAt }, trustedMs, NOW)).toBe(false);
	});

	it('stops an entry whose first counted attempt is older than the key is trusted', () => {
		const later = new Date(NOW.getTime() + 1);
		expect(keyOutlived({ attempts: 1, firstAttemptAt: sentAt }, trustedMs, later)).toBe(true);
	});

	it.each([
		['a first attempt', { attempts: 0, firstAttemptAt: null }, trustedMs],
		['an entry from before the column', { attempts: 3, firstAttemptAt: null }, trustedMs],
		['a provider without keys', { attempts: 3, firstAttemptAt: new Date(0) }, null],
	] as const)('never stops %s', (_name, entry, trusted) => {
		expect(keyOutlived(entry, trusted, NOW)).toBe(false);
	});
});

describe(guardKeyLifetime, () => {
	const trustedMs = 23 * HOUR_MS;
	const firstAttemptAt = new Date(NOW.getTime() - 22 * HOUR_MS);
	const retryAt = (hours: number): EntryOutcome => ({
		at: new Date(firstAttemptAt.getTime() + hours * HOUR_MS),
		code: 'resend.server',
		kind: 'retry',
	});

	it('keeps a retry that comes while the key is trusted', () => {
		expect(guardKeyLifetime(retryAt(23), { firstAttemptAt, trustedMs })).toStrictEqual(retryAt(23));
	});

	it('makes a retry uncertain at once when it would come after the key', () => {
		expect(guardKeyLifetime(retryAt(30), { firstAttemptAt, trustedMs })).toStrictEqual({
			code: 'resend.server',
			kind: 'uncertain',
		});
	});

	it('keeps the retries of a provider without keys and every other outcome', () => {
		expect(guardKeyLifetime(retryAt(30), { firstAttemptAt, trustedMs: null })).toStrictEqual(
			retryAt(30),
		);
		const failed: EntryOutcome = { attempt: true, code: 'resend.server', kind: 'failed' };
		expect(guardKeyLifetime(failed, { firstAttemptAt, trustedMs })).toStrictEqual(failed);
	});
});

describe(markUncertain, () => {
	it('marks entries sending for more than ten minutes as uncertain', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const senderId = await senderOn(db, admin, await graphConnection(db, admin), 'v@example.org');
		const base = { priority: 'group', senderId, source: 'wave', sourceId: WAVE_ID } as const;
		const tenMinutesAgo = new Date(NOW.getTime() - UNCERTAIN_AFTER_MS);
		await db.insert(outboxEntries).values([
			{ ...base, claimedAt: tenMinutesAgo, messageId: '<a@example.org>', status: 'sending' },
			{
				...base,
				claimedAt: new Date(tenMinutesAgo.getTime() - 1),
				messageId: '<b@example.org>',
				status: 'sending',
			},
			{ ...base, claimedAt: new Date(NOW.getTime() - DAY_MS), status: 'planned' },
		]);
		await expect(markUncertain(db, NOW)).resolves.toBe(1);
		const rows = await db
			.select({
				code: outboxEntries.lastErrorCode,
				messageId: outboxEntries.messageId,
				status: outboxEntries.status,
			})
			.from(outboxEntries)
			.orderBy(asc(outboxEntries.messageId));
		expect(rows).toStrictEqual([
			{ code: null, messageId: '<a@example.org>', status: 'sending' },
			{ code: 'outbox.interrupted', messageId: '<b@example.org>', status: 'uncertain' },
			{ code: null, messageId: null, status: 'planned' },
		]);
	});
});

describe(clearDisturbance, () => {
	it('clears only the disturbance it read', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const since = new Date(NOW.getTime() - HOUR_MS);
		const disturbance = async (): Promise<unknown> => {
			const [row] = await db
				.select({ code: mailConnections.disturbedCode, since: mailConnections.disturbedSince })
				.from(mailConnections)
				.where(eq(mailConnections.id, connectionId));
			return row;
		};
		await disturbConnection(db, connectionId, 'graph.mailbox', since);
		// Another run found the credentials refused after this one read the mailbox refusal.
		await clearDisturbance(db, connectionId, { code: 'graph.unauthorized', since });
		await expect(disturbance()).resolves.toStrictEqual({ code: 'graph.mailbox', since });
		// A disturbance that ended and began again since is another one.
		await clearDisturbance(db, connectionId, {
			code: 'graph.mailbox',
			since: new Date(since.getTime() - MINUTE_MS),
		});
		await expect(disturbance()).resolves.toStrictEqual({ code: 'graph.mailbox', since });
		await clearDisturbance(db, connectionId, { code: 'graph.mailbox', since });
		await expect(disturbance()).resolves.toStrictEqual({ code: null, since: null });
	});
});
