/*
 * Stopping a wave and sending an uncertain entry of a wave again (Design 8.5, 11.4, 18), both with
 * `send` in the wave's area; the admin role alone gives neither. A stop cancels every planned
 * entry; an entry on its way finishes (the outbox cancels it instead of planning a retry), and sent
 * entries stay. The outbox reads the wave's stop under a share lock whenever it takes an entry or
 * plans one again, so an entry that something planned while the stop ran is cancelled at its take.
 * Sending an uncertain entry again is a person's decision after checking it: the entry goes back
 * to `planned` with its id, so its Message-ID and idempotency key stay the same, and starts anew
 * (no attempts, no first attempt), so it goes out at least once.
 */
import { and, eq, isNull } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { outboxEntries, waves } from '@/server/db/schema';
import { assertArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import {
	WaveEntryNotFoundError,
	WaveEntryStateError,
	WaveNotFoundError,
	WaveStoppedError,
} from './errors';

/**
 * Stops a wave (Design 11.4): every planned entry is cancelled, the wave records who stopped it
 * and when. A second stop changes nothing and logs nothing.
 *
 * @param db The database.
 * @param actor Who stops; needs `send` in the wave's area.
 * @param waveId The wave.
 * @returns How many entries were cancelled.
 * @throws {WaveNotFoundError} When no wave has the id.
 * @throws {ForbiddenError} Without `send` in the area.
 */
async function stopWave(db: Db, actor: Principal, waveId: string): Promise<{ cancelled: number }> {
	const [wave] = await db.select({ areaId: waves.areaId }).from(waves).where(eq(waves.id, waveId));
	if (wave === undefined) throw new WaveNotFoundError();
	assertArea(actor, wave.areaId, 'send');
	return db.transaction(async (tx) => {
		// The entries first, then the wave: a take of the outbox locks an entry before it reads its wave
		// (`waveStopped` in `outbox.ts`), so the same order keeps the two from deadlocking. A stored
		// outcome reads the wave first, but of a `sending` entry, which this never locks.
		const cancelled = await tx
			.update(outboxEntries)
			.set({ status: 'cancelled' })
			.where(and(eq(outboxEntries.waveId, waveId), eq(outboxEntries.status, 'planned')))
			.returning({ id: outboxEntries.id });
		const stopped = await tx
			.update(waves)
			.set({ stoppedAt: new Date(), stoppedByUserId: actor.userId })
			.where(and(eq(waves.id, waveId), isNull(waves.stoppedAt)))
			.returning({ id: waves.id });
		if (stopped.length > 0 || cancelled.length > 0) {
			await writeAudit(tx, {
				action: 'wave.stopped',
				actorUserId: actor.userId,
				details: { cancelled: cancelled.length },
				target: `wave:${waveId}`,
			});
		}
		return { cancelled: cancelled.length };
	});
}

/**
 * Sends an uncertain entry of a wave again (Design 8.5): it goes back to `planned` and the next run
 * of the outbox takes it, with the same id, Message-ID and idempotency key. The person's decision
 * starts the entry anew: no attempts, no first attempt and no error code, so it gets the attempts
 * of a new mail and a new key window (ruling R7) and goes out at least once. The admins' digest reports it again
 * if it fails again. A stopped wave sends nothing more.
 *
 * @param db The database.
 * @param actor Who decides; needs `send` in the wave's area.
 * @param entryId The entry.
 * @throws {WaveEntryNotFoundError} When no entry of a wave has the id.
 * @throws {ForbiddenError} Without `send` in the area.
 * @throws {WaveEntryStateError} When the entry is not `uncertain` (any more).
 * @throws {WaveStoppedError} When its wave was stopped.
 */
async function resendUncertain(db: Db, actor: Principal, entryId: string): Promise<void> {
	const [entry] = await db
		.select({ areaId: waves.areaId, waveId: waves.id })
		.from(outboxEntries)
		.innerJoin(waves, eq(waves.id, outboxEntries.waveId))
		.where(eq(outboxEntries.id, entryId));
	if (entry === undefined) throw new WaveEntryNotFoundError();
	assertArea(actor, entry.areaId, 'send');
	await db.transaction(async (tx) => {
		// Read under a share lock: a stop that has marked the wave is waited for and seen. A stop that
		// marks it only after this ends finds the entry planned; the outbox cancels it at its take.
		const [wave] = await tx
			.select({ stoppedAt: waves.stoppedAt })
			.from(waves)
			.where(eq(waves.id, entry.waveId))
			.for('share');
		if (wave?.stoppedAt !== null) throw new WaveStoppedError();
		const resent = await tx
			.update(outboxEntries)
			.set({
				attempts: 0,
				claimedAt: null,
				digestedAt: null,
				firstAttemptAt: null,
				// The reason of the earlier attempt no longer holds; the activity log keeps the history.
				lastErrorCode: null,
				nextAttemptAt: null,
				status: 'planned',
			})
			.where(and(eq(outboxEntries.id, entryId), eq(outboxEntries.status, 'uncertain')))
			.returning({ id: outboxEntries.id });
		if (resent.length === 0) throw new WaveEntryStateError();
		await writeAudit(tx, {
			action: 'wave.entry_resent',
			actorUserId: actor.userId,
			details: { entryId },
			target: `wave:${entry.waveId}`,
		});
	});
}

export { resendUncertain, stopWave };
