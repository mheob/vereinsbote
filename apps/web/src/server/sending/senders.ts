/*
 * The sender addresses of the club (Design 7). Every change is the admin's. A sender belongs to
 * one connection and is released to areas; one sender at most serves the system mails. Graph
 * senders carry their own limits (30 mails per minute unless set), Resend senders inherit the
 * limits of their connection and may send an archive copy to a Bcc address. A change runs under a
 * row lock and a version. The activity log names ids only.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { normalizeEmail } from '@/server/auth/email';
import type { Db } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import {
	areas,
	mailConnections,
	outboxEntries,
	senderAreas,
	senders,
	user,
} from '@/server/db/schema';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { isValidUserEmail } from '@/server/users/form';

import type { ConnectionKind } from './connections';
import {
	SenderChangedError,
	SenderEmailTakenError,
	SenderInUseError,
	SenderInvalidError,
	SenderNotFoundError,
} from './errors';
import type { SenderField } from './errors';
import {
	DEFAULT_GRAPH_PER_MINUTE,
	MAX_ADDRESS_LENGTH,
	MAX_DAILY_LIMIT,
	MAX_NAME_LENGTH,
	MAX_PER_MINUTE,
} from './limits';
import { assertMailAddress } from './mime';

/** What the sender form sends; `perMinute` and `dailyLimit` count for Graph, `archiveBcc` for Resend. */
interface SenderInput {
	readonly email: string;
	readonly displayName: string;
	readonly replyTo: string | null;
	readonly connectionId: string;
	readonly perMinute: number | null;
	readonly dailyLimit: number | null;
	readonly archiveBcc: string | null;
	readonly areaIds: readonly string[];
}

/** A sender as the pages and the outbox read it. */
interface SenderSummary extends SenderInput {
	readonly id: string;
	readonly connectionKind: ConnectionKind;
	readonly isSystem: boolean;
	readonly version: number;
}

/**
 * Reads senders with their connection's kind and their areas.
 *
 * @param db The database.
 * @param id Only this sender, or all.
 * @returns The senders by address.
 */
async function readSenders(db: Db, id?: string): Promise<SenderSummary[]> {
	const rows = await db
		.select({
			archiveBcc: senders.archiveBcc,
			connectionId: senders.connectionId,
			connectionKind: mailConnections.kind,
			dailyLimit: senders.dailyLimit,
			displayName: senders.displayName,
			email: senders.email,
			id: senders.id,
			isSystem: senders.isSystem,
			perMinute: senders.perMinute,
			replyTo: senders.replyTo,
			version: senders.version,
		})
		.from(senders)
		.innerJoin(mailConnections, eq(mailConnections.id, senders.connectionId))
		.where(id === undefined ? undefined : eq(senders.id, id))
		.orderBy(sql`lower(${senders.email})`, senders.email, senders.id);
	if (rows.length === 0) return [];
	const released = await db
		.select({ areaId: senderAreas.areaId, senderId: senderAreas.senderId })
		.from(senderAreas)
		.where(
			inArray(
				senderAreas.senderId,
				rows.map((row) => row.id),
			),
		)
		.orderBy(asc(senderAreas.areaId));
	return rows.map((row) => ({
		archiveBcc: row.archiveBcc,
		areaIds: released.filter((entry) => entry.senderId === row.id).map((entry) => entry.areaId),
		connectionId: row.connectionId,
		connectionKind: row.connectionKind,
		dailyLimit: row.dailyLimit,
		displayName: row.displayName,
		email: row.email,
		id: row.id,
		isSystem: row.isSystem,
		perMinute: row.perMinute,
		replyTo: row.replyTo,
		version: row.version,
	}));
}

/**
 * Loads a sender without any check of who asks. Only the outbox, the system mailer and the
 * functions that checked the admin themselves call it.
 *
 * @param db The database.
 * @param id The sender.
 * @returns The sender, or null when none has the id.
 */
async function loadSender(db: Db, id: string): Promise<SenderSummary | null> {
	const [row] = await readSenders(db, id);
	return row ?? null;
}

/**
 * Lists the senders by address.
 *
 * @param db The database.
 * @param actor Who asks; an admin.
 * @returns The senders with their areas.
 * @throws {ForbiddenError} For anybody but an admin.
 */
async function listSenders(db: Db, actor: Principal): Promise<SenderSummary[]> {
	assertAdmin(actor);
	return readSenders(db);
}

/**
 * Loads one sender for its page.
 *
 * @param db The database.
 * @param actor Who asks; an admin.
 * @param id The sender.
 * @returns The sender.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {SenderNotFoundError} When no sender has the id.
 */
async function getSender(db: Db, actor: Principal, id: string): Promise<SenderSummary> {
	assertAdmin(actor);
	const sender = await loadSender(db, id);
	if (sender === null) throw new SenderNotFoundError();
	return sender;
}

/**
 * Tells whether a value is an address the app may put in a mail header.
 *
 * @param value The address, already normalized.
 * @returns True for a valid address.
 */
function isMailAddress(value: string): boolean {
	if (value.length > MAX_ADDRESS_LENGTH || !isValidUserEmail(value)) return false;
	try {
		assertMailAddress(value);
		return true;
	} catch {
		return false;
	}
}

/**
 * An address in its stored form.
 *
 * @param value What the admin typed.
 * @param field The field it belongs to.
 * @returns The normalized address.
 * @throws {SenderInvalidError} When it is not an address a header can carry.
 */
function checkedAddress(value: string, field: SenderField): string {
	const normalized = normalizeEmail(value);
	if (!isMailAddress(normalized)) throw new SenderInvalidError(field);
	return normalized;
}

/**
 * An optional address: empty is none.
 *
 * @param value What the admin typed, or null.
 * @param field The field it belongs to.
 * @returns The normalized address, or null.
 * @throws {SenderInvalidError} When it is not an address a header can carry.
 */
function optionalAddress(value: string | null, field: SenderField): string | null {
	return value === null || value.trim() === '' ? null : checkedAddress(value, field);
}

/**
 * A whole number in a range, or null for none.
 *
 * @param value The number or null.
 * @param field The field it belongs to.
 * @param max The largest allowed value.
 * @returns The number, or null.
 * @throws {SenderInvalidError} For anything else than an integer from 1 to `max`.
 */
function optionalLimit(value: number | null, field: SenderField, max: number): number | null {
	if (value === null) return null;
	if (!Number.isInteger(value) || value < 1 || value > max) throw new SenderInvalidError(field);
	return value;
}

/** The columns a checked input sets. */
interface Columns {
	readonly email: string;
	readonly displayName: string;
	readonly replyTo: string | null;
	readonly connectionId: string;
	readonly perMinute: number | null;
	readonly dailyLimit: number | null;
	readonly archiveBcc: string | null;
	readonly areaIds: readonly string[];
}

/**
 * The kind of a connection and the check that the areas exist. Runs queries: call it before a
 * transaction.
 *
 * @param db The database.
 * @param connectionId The connection.
 * @param areaIds The areas, without doubles.
 * @returns The kind of the connection.
 * @throws {SenderInvalidError} When the connection or an area does not exist.
 */
async function connectionKindOf(
	db: Db,
	connectionId: string,
	areaIds: readonly string[],
): Promise<ConnectionKind> {
	const [connection] = await db
		.select({ kind: mailConnections.kind })
		.from(mailConnections)
		.where(eq(mailConnections.id, connectionId));
	if (connection === undefined) throw new SenderInvalidError('connectionId');
	if (areaIds.length > 0) {
		const known = await db.select({ id: areas.id }).from(areas).where(inArray(areas.id, areaIds));
		if (known.length !== areaIds.length) throw new SenderInvalidError('areaIds');
	}
	return connection.kind;
}

/**
 * The limits and the archive address of an input for the kind of its connection: Graph senders
 * carry limits (30 per minute unless set), Resend senders an archive address.
 *
 * @param kind The kind of the connection.
 * @param input What the form sent.
 * @returns The three columns.
 * @throws {SenderInvalidError} When a value is out of range.
 */
function kindColumns(
	kind: ConnectionKind,
	input: Readonly<SenderInput>,
): Pick<Columns, 'archiveBcc' | 'dailyLimit' | 'perMinute'> {
	if (kind === 'resend') {
		return {
			archiveBcc: optionalAddress(input.archiveBcc, 'archiveBcc'),
			dailyLimit: null,
			perMinute: null,
		};
	}
	return {
		archiveBcc: null,
		dailyLimit: optionalLimit(input.dailyLimit, 'dailyLimit', MAX_DAILY_LIMIT),
		perMinute:
			optionalLimit(input.perMinute, 'perMinute', MAX_PER_MINUTE) ?? DEFAULT_GRAPH_PER_MINUTE,
	};
}

/**
 * Checks an input against the connection and the areas it names. Runs queries: call it before a
 * transaction.
 *
 * @param db The database.
 * @param input What the form sent.
 * @returns The columns to write; Graph limits default, the fields of the other kind are dropped.
 * @throws {SenderInvalidError} When a value is missing, out of range or names nothing.
 */
async function checkedColumns(db: Db, input: Readonly<SenderInput>): Promise<Columns> {
	const displayName = input.displayName.trim();
	if (displayName === '' || displayName.length > MAX_NAME_LENGTH) {
		throw new SenderInvalidError('displayName');
	}
	const email = checkedAddress(input.email, 'email');
	const replyTo = optionalAddress(input.replyTo, 'replyTo');
	const areaIds = [...new Set(input.areaIds)];
	const kind = await connectionKindOf(db, input.connectionId, areaIds);
	return {
		...kindColumns(kind, input),
		areaIds,
		connectionId: input.connectionId,
		displayName,
		email,
		replyTo,
	};
}

/**
 * Logs a change of a sender with its id only.
 *
 * @param tx The transaction.
 * @param action What happened.
 * @param actor Who did it.
 * @param senderId The sender.
 */
// oxlint-disable-next-line max-params -- the transaction, the action, the actor and the sender
async function logSender(
	tx: Db,
	action: AuditAction,
	actor: Principal,
	senderId: string,
): Promise<void> {
	await writeAudit(tx, { action, actorUserId: actor.userId, target: `sender:${senderId}` });
}

/** What the sender form offers to choose from, and the admin's own address for the self test. */
interface SenderFormOptions {
	readonly connections: readonly Readonly<{ id: string; name: string; kind: ConnectionKind }>[];
	readonly areas: readonly Readonly<{ id: string; name: string }>[];
	readonly adminEmail: string;
}

/**
 * The connections and areas a sender can use, by name.
 *
 * @param db The database.
 * @param actor Who asks; an admin.
 * @returns The choices and the address of the asking admin.
 * @throws {ForbiddenError} For anybody but an admin.
 */
async function senderFormOptions(db: Db, actor: Principal): Promise<SenderFormOptions> {
	assertAdmin(actor);
	const [connections, areaRows, [admin]] = await Promise.all([
		db
			.select({ id: mailConnections.id, kind: mailConnections.kind, name: mailConnections.name })
			.from(mailConnections)
			.orderBy(sql`lower(${mailConnections.name})`, mailConnections.id),
		db
			.select({ id: areas.id, name: areas.name })
			.from(areas)
			.orderBy(sql`lower(${areas.name})`, areas.id),
		db.select({ email: user.email }).from(user).where(eq(user.id, actor.userId)),
	]);
	return { adminEmail: admin?.email ?? '', areas: areaRows, connections };
}

/**
 * Creates a sender.
 *
 * @param db The database.
 * @param actor Who creates it; an admin.
 * @param input The form.
 * @returns The id of the sender.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {SenderInvalidError} When a value is missing, out of range or names nothing.
 * @throws {SenderEmailTakenError} When another sender has the address.
 */
async function createSender(
	db: Db,
	actor: Principal,
	input: Readonly<SenderInput>,
): Promise<{ id: string }> {
	assertAdmin(actor);
	const { areaIds, ...columns } = await checkedColumns(db, input);
	try {
		return await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(senders)
				.values({ ...columns, createdByUserId: actor.userId, updatedByUserId: actor.userId })
				.returning({ id: senders.id });
			if (row === undefined) throw new Error('Inserting the sender returned no row.');
			if (areaIds.length > 0) {
				await tx
					.insert(senderAreas)
					.values(areaIds.map((areaId) => ({ areaId, senderId: row.id })));
			}
			await logSender(tx, 'sender.created', actor, row.id);
			return { id: row.id };
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new SenderEmailTakenError();
		throw error;
	}
}

/**
 * Changes a sender. The row is locked and its version compared, so of two saves based on the same
 * version the second is refused.
 *
 * @param db The database.
 * @param actor Who changes it; an admin.
 * @param id The sender.
 * @param input The form.
 * @param version The version the page loaded.
 * @returns The new version.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {SenderNotFoundError} When no sender has the id.
 * @throws {SenderChangedError} When somebody saved it since the page loaded it.
 * @throws {SenderInvalidError} When a value is missing, out of range or names nothing.
 * @throws {SenderEmailTakenError} When another sender has the address.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function updateSender(
	db: Db,
	actor: Principal,
	id: string,
	input: Readonly<SenderInput>,
	version: number,
): Promise<{ version: number }> {
	assertAdmin(actor);
	const { areaIds, ...columns } = await checkedColumns(db, input);
	try {
		return await db.transaction(async (tx) => {
			const [row] = await tx
				.select({ version: senders.version })
				.from(senders)
				.where(eq(senders.id, id))
				.for('update');
			if (row === undefined) throw new SenderNotFoundError();
			if (row.version !== version) throw new SenderChangedError();
			// Task 12 hooks in here: taking an area from the sender is refused (SenderAreaInUseError)
			// while an occasion of that area uses the sender.
			const next = version + 1;
			await tx
				.update(senders)
				.set({ ...columns, updatedAt: new Date(), updatedByUserId: actor.userId, version: next })
				.where(and(eq(senders.id, id), eq(senders.version, version)));
			await tx.delete(senderAreas).where(eq(senderAreas.senderId, id));
			if (areaIds.length > 0) {
				await tx.insert(senderAreas).values(areaIds.map((areaId) => ({ areaId, senderId: id })));
			}
			await logSender(tx, 'sender.updated', actor, id);
			return { version: next };
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new SenderEmailTakenError();
		throw error;
	}
}

/**
 * Deletes a sender and its area releases. Refused while outbox entries of the sender are open
 * (planned, sending or uncertain); entries that are done keep their history without the sender.
 * The row lock waits for a transaction that is adding entries for the sender, so their check
 * sees them.
 *
 * @param db The database.
 * @param actor Who deletes it; an admin.
 * @param id The sender.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {SenderNotFoundError} When no sender has the id.
 * @throws {SenderInUseError} When open outbox entries hang on the sender (`entries`).
 */
async function deleteSender(db: Db, actor: Principal, id: string): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ id: senders.id })
			.from(senders)
			.where(eq(senders.id, id))
			.for('update');
		if (row === undefined) throw new SenderNotFoundError();
		const [open] = await tx
			.select({ id: outboxEntries.id })
			.from(outboxEntries)
			.where(
				and(
					eq(outboxEntries.senderId, id),
					inArray(outboxEntries.status, ['planned', 'sending', 'uncertain']),
				),
			)
			.limit(1);
		if (open !== undefined) throw new SenderInUseError('entries');
		// Task 12 hooks in here: an occasion that uses the sender refuses it ('occasions').
		await tx.delete(senders).where(eq(senders.id, id));
		await logSender(tx, 'sender.deleted', actor, id);
	});
}

/**
 * Makes a sender the one that sends the system mails. The previous one stops being it.
 *
 * @param db The database.
 * @param actor Who decides; an admin.
 * @param senderId The sender.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {SenderNotFoundError} When no sender has the id.
 * @throws {SenderChangedError} When another admin chose a system sender at the same moment.
 */
async function setSystemSender(db: Db, actor: Principal, senderId: string): Promise<void> {
	assertAdmin(actor);
	try {
		await db.transaction(async (tx) => {
			await tx.update(senders).set({ isSystem: false }).where(eq(senders.isSystem, true));
			const chosen = await tx
				.update(senders)
				.set({ isSystem: true })
				.where(eq(senders.id, senderId))
				.returning({ id: senders.id });
			if (chosen.length === 0) throw new SenderNotFoundError();
			await writeAudit(tx, {
				action: 'sender.system_set',
				actorUserId: actor.userId,
				target: `sender:${senderId}`,
			});
		});
	} catch (error) {
		// Somebody chose another system sender at the same moment: the partial unique index refuses.
		if (isUniqueViolation(error)) throw new SenderChangedError();
		throw error;
	}
}

/**
 * Removes the system mark from a sender, so that no sender sends the system mails. Only while
 * that sender still holds it: a page that is out of date must not clear the choice another admin
 * made since. The log entry has no target, like a choice of „none“.
 *
 * @param db The database.
 * @param actor Who decides; an admin.
 * @param senderId The sender the page shows as the system sender.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {SenderChangedError} When the sender no longer holds the mark.
 * @throws {SenderNotFoundError} When no sender has the id.
 */
async function clearSystemSender(db: Db, actor: Principal, senderId: string): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		const cleared = await tx
			.update(senders)
			.set({ isSystem: false })
			.where(and(eq(senders.id, senderId), eq(senders.isSystem, true)))
			.returning({ id: senders.id });
		if (cleared.length === 0) {
			const [exists] = await tx
				.select({ id: senders.id })
				.from(senders)
				.where(eq(senders.id, senderId));
			throw exists === undefined ? new SenderNotFoundError() : new SenderChangedError();
		}
		await writeAudit(tx, { action: 'sender.system_set', actorUserId: actor.userId });
	});
}

/**
 * The senders released to an area, by address; the sender choice of an occasion lists them.
 *
 * @param db The database.
 * @param areaId The area.
 * @returns The senders.
 */
async function sendersForArea(
	db: Db,
	areaId: string,
): Promise<{ id: string; email: string; displayName: string }[]> {
	return db
		.select({ displayName: senders.displayName, email: senders.email, id: senders.id })
		.from(senders)
		.innerJoin(senderAreas, eq(senderAreas.senderId, senders.id))
		.where(eq(senderAreas.areaId, areaId))
		.orderBy(sql`lower(${senders.email})`, senders.email, senders.id);
}

export {
	clearSystemSender,
	createSender,
	deleteSender,
	getSender,
	isMailAddress,
	listSenders,
	loadSender,
	senderFormOptions,
	sendersForArea,
	setSystemSender,
	updateSender,
};
export type { SenderFormOptions, SenderInput, SenderSummary };
