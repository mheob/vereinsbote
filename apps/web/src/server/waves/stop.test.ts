import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { insertContact } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { auditLog, outboxEntries, waves } from '@/server/db/schema';
import { ForbiddenError } from '@/server/permissions/principal';

import { WaveEntryNotFoundError, WaveEntryStateError, WaveNotFoundError } from './errors';
import { resendUncertain, stopWave } from './stop';
import { confirmTestWave, setUpWaveClub, waveEntryIds } from './testing';
import type { WaveClub } from './testing';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');

/** A club with a confirmed wave to three members, and the wave's entries by id. */
interface StopFixture {
	readonly c: WaveClub;
	readonly waveId: string;
	readonly entryIds: readonly string[];
}

/**
 * A club with a confirmed wave to three members of their own addresses.
 *
 * @returns The club, the wave and its entries.
 */
async function waveOfThree(): Promise<StopFixture> {
	const c = await setUpWaveClub();
	for (const number of ['1', '2', '3']) {
		// oxlint-disable-next-line no-await-in-loop -- one after another, for a fixed order
		await insertContact(c.db, {
			email: `mitglied-${number}@example.org`,
			kind: 'member',
			memberNumber: number,
		});
	}
	const waveId = await confirmTestWave(c, NOW);
	return { c, entryIds: await waveEntryIds(c.db, waveId), waveId };
}

/**
 * Sets columns of an entry.
 *
 * @param db The database.
 * @param id The entry.
 * @param values The columns.
 */
async function setEntry(
	db: Db,
	id: string,
	values: Readonly<Partial<typeof outboxEntries.$inferInsert>>,
): Promise<void> {
	await db.update(outboxEntries).set(values).where(eq(outboxEntries.id, id));
}

/**
 * The statuses of entries, in the order of the ids.
 *
 * @param db The database.
 * @param ids The entries.
 * @returns Their statuses.
 */
async function statusesOf(db: Db, ids: readonly string[]): Promise<string[]> {
	const rows = await db
		.select({ id: outboxEntries.id, status: outboxEntries.status })
		.from(outboxEntries)
		.where(inArray(outboxEntries.id, [...ids]));
	return ids.map((id) => rows.find((row) => row.id === id)?.status ?? 'gone');
}

/**
 * When and by whom a wave was stopped.
 *
 * @param db The database.
 * @param waveId The wave.
 * @returns The two columns.
 */
async function stopOf(
	db: Db,
	waveId: string,
): Promise<{ stoppedAt: Date | null; stoppedByUserId: string | null } | undefined> {
	const [row] = await db
		.select({ stoppedAt: waves.stoppedAt, stoppedByUserId: waves.stoppedByUserId })
		.from(waves)
		.where(eq(waves.id, waveId));
	return row;
}

/**
 * The audit entries of an action.
 *
 * @param db The database.
 * @param action The action.
 * @returns Actor, target and details of each.
 */
async function logged(
	db: Db,
	action: 'wave.entry_resent' | 'wave.stopped',
): Promise<{ actorUserId: string | null; target: string | null; details: unknown }[]> {
	return db
		.select({
			actorUserId: auditLog.actorUserId,
			details: auditLog.details,
			target: auditLog.target,
		})
		.from(auditLog)
		.where(eq(auditLog.action, action));
}

describe(stopWave, () => {
	it('stops a wave and keeps entries already sent', async () => {
		const { c, entryIds, waveId } = await waveOfThree();
		const [sentId = '', sendingId = ''] = entryIds;
		await setEntry(c.db, sentId, { messageId: '<a@example.org>', sentAt: NOW, status: 'sent' });
		await setEntry(c.db, sendingId, {
			claimedAt: NOW,
			messageId: '<b@example.org>',
			status: 'sending',
		});
		await expect(stopWave(c.db, c.sender, waveId)).resolves.toStrictEqual({ cancelled: 1 });
		await expect(statusesOf(c.db, entryIds)).resolves.toStrictEqual([
			'sent',
			'sending',
			'cancelled',
		]);
		await expect(stopOf(c.db, waveId)).resolves.toStrictEqual({
			stoppedAt: expect.any(Date) as unknown,
			stoppedByUserId: c.sender.userId,
		});
		await expect(logged(c.db, 'wave.stopped')).resolves.toStrictEqual([
			{ actorUserId: c.sender.userId, details: { cancelled: 1 }, target: `wave:${waveId}` },
		]);
	});

	it('changes and logs nothing when the wave is stopped already', async () => {
		const { c, waveId } = await waveOfThree();
		await stopWave(c.db, c.sender, waveId);
		const first = await stopOf(c.db, waveId);
		await expect(stopWave(c.db, c.sender, waveId)).resolves.toStrictEqual({ cancelled: 0 });
		await expect(stopOf(c.db, waveId)).resolves.toStrictEqual(first);
		await expect(logged(c.db, 'wave.stopped')).resolves.toHaveLength(1);
	});

	it('needs send in the area of an existing wave', async () => {
		const { c, waveId } = await waveOfThree();
		await expect(stopWave(c.db, c.editor, waveId)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(stopWave(c.db, c.admin, waveId)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(stopWave(c.db, c.sender, randomUUID())).rejects.toBeInstanceOf(WaveNotFoundError);
	});
});

describe(resendUncertain, () => {
	it('resends an uncertain entry only on request and logs it', async () => {
		const { c, entryIds, waveId } = await waveOfThree();
		const [id = ''] = entryIds;
		await setEntry(c.db, id, {
			attempts: 3,
			claimedAt: NOW,
			digestedAt: NOW,
			firstAttemptAt: NOW,
			lastErrorCode: 'outbox.interrupted',
			messageId: '<unklar@example.org>',
			status: 'uncertain',
		});
		await resendUncertain(c.db, c.sender, id);
		const [row] = await c.db.select().from(outboxEntries).where(eq(outboxEntries.id, id));
		expect(row).toMatchObject({
			attempts: 0,
			digestedAt: null,
			firstAttemptAt: null,
			id,
			messageId: '<unklar@example.org>',
			nextAttemptAt: null,
			status: 'planned',
		});
		await expect(logged(c.db, 'wave.entry_resent')).resolves.toStrictEqual([
			{ actorUserId: c.sender.userId, details: { entryId: id }, target: `wave:${waveId}` },
		]);
		await expect(resendUncertain(c.db, c.sender, id)).rejects.toBeInstanceOf(WaveEntryStateError);
	});

	it('needs send in the area and an uncertain entry', async () => {
		const { c, entryIds } = await waveOfThree();
		const [uncertainId = '', plannedId = ''] = entryIds;
		await setEntry(c.db, uncertainId, { messageId: '<unklar@example.org>', status: 'uncertain' });
		await expect(resendUncertain(c.db, c.editor, uncertainId)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(resendUncertain(c.db, c.admin, uncertainId)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(resendUncertain(c.db, c.sender, plannedId)).rejects.toBeInstanceOf(
			WaveEntryStateError,
		);
		await expect(resendUncertain(c.db, c.sender, randomUUID())).rejects.toBeInstanceOf(
			WaveEntryNotFoundError,
		);
		await expect(statusesOf(c.db, [uncertainId])).resolves.toStrictEqual(['uncertain']);
	});

	it('sends nothing more of a stopped wave', async () => {
		const { c, entryIds, waveId } = await waveOfThree();
		const [id = ''] = entryIds;
		await setEntry(c.db, id, { messageId: '<unklar@example.org>', status: 'uncertain' });
		await expect(stopWave(c.db, c.sender, waveId)).resolves.toStrictEqual({ cancelled: 2 });
		await expect(resendUncertain(c.db, c.sender, id)).rejects.toBeInstanceOf(WaveEntryStateError);
		await expect(statusesOf(c.db, [id])).resolves.toStrictEqual(['uncertain']);
	});
});
