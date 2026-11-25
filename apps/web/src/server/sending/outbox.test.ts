import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { setUpClub } from '@/server/contacts/testing';
import { outboxEntries } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import {
	MAX_ATTEMPTS,
	RETRY_DELAYS_MS,
	UNCERTAIN_AFTER_MS,
	markUncertain,
	nextAttemptDelay,
	outcomeOf,
} from './outbox';
import { graphConnection, senderOn } from './testing';
import type { SendFailureClass, SendResult } from './transport';

const WAVE_ID = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-11-25T09:00:00.000Z');
const NEXT_DAY = new Date('2026-11-25T23:00:00.000Z');
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
	const at = { attempts: 0, nextDay: NEXT_DAY, now: NOW };

	it.each([
		[{ ok: true, providerId: 'p-1' }, 0, { kind: 'sent', providerId: 'p-1' }],
		[refused('uncertain'), 0, { code: 'x.code', kind: 'uncertain' }],
		[refused('rejected'), 0, { attempt: true, code: 'x.code', kind: 'failed' }],
		[refused('unauthorized'), 0, { code: 'x.code', kind: 'release' }],
		[refused('quota'), 0, { code: 'x.code', kind: 'defer', until: NEXT_DAY }],
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
