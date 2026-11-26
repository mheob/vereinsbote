/*
 * The occasions of the areas (Design 9): a recurring kind of mail („Einladungen“), each event a
 * new wave. Reading needs `read` in the area, creating, changing and removing `edit`; the admin
 * role alone gives neither. The template must belong to the area and the sender be released to
 * it; both are checked under locks that the template and sender functions respect, so a release
 * or a template cannot vanish between the check and the write. An occasion with waves is
 * archived instead of deleted: it cannot be chosen or changed any more, but it keeps its
 * history, its opt-outs and the hold on its template and sender. The activity log names ids and
 * the area.
 */
import { and, count, eq, inArray, max, sql } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { UnknownAreaError } from '@/server/contacts/errors';
import type { Db } from '@/server/db/client';
import { isForeignKeyViolationOf, isUniqueViolation } from '@/server/db/errors';
import {
	areas,
	OCCASION_SENDER_FK,
	OCCASION_TEMPLATE_FK,
	occasions,
	senderAreas,
	senders,
	templates,
	waves,
} from '@/server/db/schema';
import { assertArea, canAccessArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import {
	OccasionChangedError,
	OccasionInvalidError,
	OccasionNameTakenError,
	OccasionNotFoundError,
} from './errors';
import { MAX_OCCASION_NAME_LENGTH } from './limits';
import type { OccasionKind } from './limits';

/** What the occasion form sends. */
interface OccasionInput {
	readonly name: string;
	readonly kind: OccasionKind;
	readonly templateId: string;
	readonly senderId: string;
	readonly unsubscribe: boolean;
}

/** An occasion as the pages read it. */
interface OccasionRecord extends OccasionInput {
	readonly id: string;
	readonly areaId: string;
	readonly trigger: 'manual';
	/** Set when an occasion with waves was removed; null for a live occasion. */
	readonly archivedAt: Date | null;
	/** How many waves the occasion has. */
	readonly waves: number;
	/** When the latest wave was made; null without waves. */
	readonly lastWaveAt: Date | null;
	/** Sent back with a change or a removal; a newer one refuses both. */
	readonly version: number;
}

/** How many waves an occasion has and when the latest was made. */
interface WaveStats {
	readonly waves: number;
	readonly lastWaveAt: Date | null;
}

/**
 * The count of waves of an occasion.
 *
 * @param db The database or transaction.
 * @param occasionId The occasion.
 * @returns The number of waves.
 */
async function countWaves(db: Db, occasionId: string): Promise<number> {
	const [row] = await db
		.select({ waves: count() })
		.from(waves)
		.where(eq(waves.occasionId, occasionId));
	return row?.waves ?? 0;
}

/**
 * The waves of occasions: how many and when the latest was made, in one query.
 *
 * @param db The database.
 * @param occasionIds The occasions.
 * @returns The numbers per occasion that has waves.
 */
async function waveStats(db: Db, occasionIds: readonly string[]): Promise<Map<string, WaveStats>> {
	if (occasionIds.length === 0) return new Map();
	const rows = await db
		.select({
			lastWaveAt: max(waves.createdAt),
			occasionId: waves.occasionId,
			waves: count(),
		})
		.from(waves)
		.where(inArray(waves.occasionId, [...occasionIds]))
		.groupBy(waves.occasionId);
	return new Map(
		rows.map(({ lastWaveAt, occasionId, waves: made }) => [
			occasionId,
			{ lastWaveAt, waves: made },
		]),
	);
}

/**
 * The stored row as a record.
 *
 * @param row The row.
 * @param stats Its waves; none when absent.
 * @returns The record.
 */
function toRecord(
	row: typeof occasions.$inferSelect,
	stats: WaveStats | undefined,
): OccasionRecord {
	return {
		archivedAt: row.archivedAt,
		areaId: row.areaId,
		id: row.id,
		kind: row.kind,
		lastWaveAt: stats?.lastWaveAt ?? null,
		name: row.name,
		senderId: row.senderId,
		templateId: row.templateId,
		trigger: row.trigger,
		unsubscribe: row.unsubscribe,
		version: row.version,
		waves: stats?.waves ?? 0,
	};
}

/**
 * Lists the occasions of every area the user may read, by name; archived ones come along.
 *
 * @param db The database.
 * @param actor Who asks.
 * @returns The occasions; none without `read` in any area.
 */
async function listOccasions(db: Db, actor: Principal): Promise<OccasionRecord[]> {
	const areaIds = [...actor.areas.keys()].filter((areaId) => canAccessArea(actor, areaId, 'read'));
	if (areaIds.length === 0) return [];
	const rows = await db
		.select()
		.from(occasions)
		.where(inArray(occasions.areaId, areaIds))
		.orderBy(sql`lower(${occasions.name})`, occasions.name, occasions.id);
	const stats = await waveStats(
		db,
		rows.map(({ id }) => id),
	);
	return rows.map((row) => toRecord(row, stats.get(row.id)));
}

/**
 * Loads an occasion for its page.
 *
 * @param db The database.
 * @param actor Who asks; needs `read` in the occasion's area.
 * @param id The occasion.
 * @returns The occasion.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `read` in the area.
 */
async function getOccasion(db: Db, actor: Principal, id: string): Promise<OccasionRecord> {
	const [row] = await db.select().from(occasions).where(eq(occasions.id, id));
	if (row === undefined) throw new OccasionNotFoundError();
	assertArea(actor, row.areaId, 'read');
	const stats = await waveStats(db, [row.id]);
	return toRecord(row, stats.get(row.id));
}

/**
 * The name in its stored form.
 *
 * @param name What the user typed.
 * @returns The trimmed name.
 * @throws {OccasionInvalidError} When it is empty or too long (`name`).
 */
function checkedName(name: string): string {
	const trimmed = name.trim();
	if (trimmed === '' || trimmed.length > MAX_OCCASION_NAME_LENGTH) {
		throw new OccasionInvalidError('name');
	}
	return trimmed;
}

/**
 * Checks that the template belongs to the area and the sender is released to it, and holds both
 * until the transaction ends: the sender row is locked in the mode that `updateSender` and
 * `deleteSender` wait for, and the foreign key keeps the template.
 *
 * @param tx The transaction.
 * @param areaId The area.
 * @param input The input.
 * @throws {OccasionInvalidError} When the template is of another area or gone (`templateArea`), or
 *   the sender is not released to the area or gone (`senderNotReleased`).
 */
async function checkChoices(tx: Db, areaId: string, input: Readonly<OccasionInput>): Promise<void> {
	const [template] = await tx
		.select({ areaId: templates.areaId })
		.from(templates)
		.where(eq(templates.id, input.templateId))
		.for('key share');
	if (template?.areaId !== areaId) throw new OccasionInvalidError('templateArea');
	const [sender] = await tx
		.select({ id: senders.id })
		.from(senders)
		.where(eq(senders.id, input.senderId))
		.for('share');
	if (sender === undefined) throw new OccasionInvalidError('senderNotReleased');
	const [release] = await tx
		.select({ senderId: senderAreas.senderId })
		.from(senderAreas)
		.where(and(eq(senderAreas.senderId, input.senderId), eq(senderAreas.areaId, areaId)));
	if (release === undefined) throw new OccasionInvalidError('senderNotReleased');
}

/**
 * Logs a change of an occasion with its id and the area.
 *
 * @param tx The transaction.
 * @param entry The action, who did it, the occasion and its area.
 */
async function logOccasion(
	tx: Db,
	entry: Readonly<{ action: AuditAction; actor: Principal; occasionId: string; areaId: string }>,
): Promise<void> {
	await writeAudit(tx, {
		action: entry.action,
		actorUserId: entry.actor.userId,
		details: { areaId: entry.areaId },
		target: `occasion:${entry.occasionId}`,
	});
}

/**
 * Runs a write that may hit the unique name of the area or a foreign key that a template or
 * sender deleted meanwhile breaks.
 *
 * @param write The write.
 * @returns What the write gives.
 * @throws {OccasionNameTakenError} When another occasion of the area has the name.
 * @throws {OccasionInvalidError} When the template or the sender is gone.
 */
async function withRefusals<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (isUniqueViolation(error)) throw new OccasionNameTakenError();
		if (isForeignKeyViolationOf(error, OCCASION_TEMPLATE_FK))
			throw new OccasionInvalidError('templateArea');
		if (isForeignKeyViolationOf(error, OCCASION_SENDER_FK)) {
			throw new OccasionInvalidError('senderNotReleased');
		}
		throw error;
	}
}

/**
 * Creates an occasion with the manual trigger.
 *
 * @param db The database.
 * @param actor Who creates it; needs `edit` in the area.
 * @param areaId The area.
 * @param input The form.
 * @returns The id of the occasion.
 * @throws {ForbiddenError} Without `edit` in the area.
 * @throws {UnknownAreaError} When the area does not exist (any more).
 * @throws {OccasionInvalidError} For a bad name, a template of another area or a sender that is not
 *   released to the area.
 * @throws {OccasionNameTakenError} When another occasion of the area has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function createOccasion(
	db: Db,
	actor: Principal,
	areaId: string,
	input: Readonly<OccasionInput>,
): Promise<{ id: string }> {
	assertArea(actor, areaId, 'edit');
	const name = checkedName(input.name);
	return withRefusals(async () =>
		db.transaction(async (tx) => {
			const [area] = await tx
				.select({ id: areas.id })
				.from(areas)
				.where(eq(areas.id, areaId))
				.for('key share');
			if (area === undefined) throw new UnknownAreaError();
			await checkChoices(tx, areaId, input);
			const [row] = await tx
				.insert(occasions)
				.values({
					areaId,
					createdByUserId: actor.userId,
					kind: input.kind,
					name,
					senderId: input.senderId,
					templateId: input.templateId,
					unsubscribe: input.unsubscribe,
					updatedByUserId: actor.userId,
				})
				.returning({ id: occasions.id });
			if (row === undefined) throw new Error('Inserting the occasion returned no row.');
			await logOccasion(tx, { action: 'occasion.created', actor, areaId, occasionId: row.id });
			return { id: row.id };
		}),
	);
}

/**
 * Locks an occasion for a change and compares its version.
 *
 * @param tx The transaction.
 * @param id The occasion.
 * @param version The version the change was based on.
 * @returns The occasion's area.
 * @throws {OccasionNotFoundError} When the occasion is gone.
 * @throws {OccasionChangedError} When somebody changed it since.
 * @throws {OccasionInvalidError} When it is archived (`archived`).
 */
async function lockLive(tx: Db, id: string, version: number): Promise<string> {
	const [row] = await tx
		.select({
			archivedAt: occasions.archivedAt,
			areaId: occasions.areaId,
			version: occasions.version,
		})
		.from(occasions)
		.where(eq(occasions.id, id))
		.for('update');
	if (row === undefined) throw new OccasionNotFoundError();
	if (row.version !== version) throw new OccasionChangedError();
	if (row.archivedAt !== null) throw new OccasionInvalidError('archived');
	return row.areaId;
}

/**
 * The area of an occasion, for the right check before a change.
 *
 * @param db The database.
 * @param id The occasion.
 * @returns The area.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 */
async function areaOfOccasion(db: Db, id: string): Promise<string> {
	const [row] = await db
		.select({ areaId: occasions.areaId })
		.from(occasions)
		.where(eq(occasions.id, id));
	if (row === undefined) throw new OccasionNotFoundError();
	return row.areaId;
}

/**
 * Changes an occasion. The row is locked and its version compared, so of two saves based on the
 * same version the second is refused. An archived occasion cannot be changed.
 *
 * @param db The database.
 * @param actor Who changes it; needs `edit` in the occasion's area.
 * @param id The occasion.
 * @param input The form.
 * @param version The version the page loaded.
 * @returns The new version.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `edit` in the area.
 * @throws {OccasionChangedError} When somebody saved since the page loaded the occasion.
 * @throws {OccasionInvalidError} For a bad name, a template of another area, a sender that is not
 *   released to the area, or an archived occasion.
 * @throws {OccasionNameTakenError} When another occasion of the area has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function updateOccasion(
	db: Db,
	actor: Principal,
	id: string,
	input: Readonly<OccasionInput>,
	version: number,
): Promise<{ version: number }> {
	const areaId = await areaOfOccasion(db, id);
	assertArea(actor, areaId, 'edit');
	const name = checkedName(input.name);
	return withRefusals(async () =>
		db.transaction(async (tx) => {
			await lockLive(tx, id, version);
			await checkChoices(tx, areaId, input);
			const next = version + 1;
			await tx
				.update(occasions)
				.set({
					kind: input.kind,
					name,
					senderId: input.senderId,
					templateId: input.templateId,
					unsubscribe: input.unsubscribe,
					updatedAt: new Date(),
					updatedByUserId: actor.userId,
					version: next,
				})
				.where(eq(occasions.id, id));
			await logOccasion(tx, { action: 'occasion.updated', actor, areaId, occasionId: id });
			return { version: next };
		}),
	);
}

/**
 * Removes an occasion: one without waves is deleted (with its opt-outs), one with waves is
 * archived, so its history and its opt-outs stay.
 *
 * @param db The database.
 * @param actor Who removes it; needs `edit` in the occasion's area.
 * @param id The occasion.
 * @param version The version the page loaded.
 * @returns What happened to the occasion.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `edit` in the area.
 * @throws {OccasionChangedError} When somebody saved since the page loaded the occasion.
 * @throws {OccasionInvalidError} When the occasion is archived already (`archived`).
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function removeOccasion(
	db: Db,
	actor: Principal,
	id: string,
	version: number,
): Promise<'archived' | 'deleted'> {
	const areaId = await areaOfOccasion(db, id);
	assertArea(actor, areaId, 'edit');
	return db.transaction(async (tx) => {
		// The lock waits for a wave being made (`confirmWave` holds the row), so its count is final.
		await lockLive(tx, id, version);
		if ((await countWaves(tx, id)) === 0) {
			await tx.delete(occasions).where(eq(occasions.id, id));
			await logOccasion(tx, { action: 'occasion.deleted', actor, areaId, occasionId: id });
			return 'deleted';
		}
		await tx
			.update(occasions)
			.set({
				archivedAt: new Date(),
				updatedAt: new Date(),
				updatedByUserId: actor.userId,
				version: version + 1,
			})
			.where(eq(occasions.id, id));
		await logOccasion(tx, { action: 'occasion.archived', actor, areaId, occasionId: id });
		return 'archived';
	});
}

export { createOccasion, getOccasion, listOccasions, removeOccasion, updateOccasion };
export { defaultUnsubscribe, MAX_OCCASION_NAME_LENGTH } from './limits';
export type { OccasionInput, OccasionRecord };
export type { OccasionKind } from './limits';
