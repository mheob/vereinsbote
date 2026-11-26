/*
 * The connections to the mail providers (Design 6): Microsoft Graph and Resend. Every change is
 * the admin's. The secrets are encrypted before they are stored (the associated data names the
 * table, the row and the column) and are never read back for a page: a list or a detail carries
 * only whether a secret is stored. A save with an empty secret keeps the stored one. A change runs
 * under a row lock and a version. The activity log names ids only.
 */
import { and, count, eq, inArray, sql } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { todayInClubZone } from '@/server/contacts/calendar';
import { encryptSecret, secretAad } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { isForeignKeyViolationOf, isUniqueViolation } from '@/server/db/errors';
import { mailConnections, outboxEntries, senders } from '@/server/db/schema';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import {
	ConnectionChangedError,
	ConnectionInUseError,
	ConnectionInvalidError,
	ConnectionNameTakenError,
	ConnectionNotFoundError,
} from './errors';
import type { ConnectionField } from './errors';
import type { RestrictionResult } from './graph';
import { MAX_CREDENTIAL_LENGTH, MAX_DAILY_LIMIT, MAX_NAME_LENGTH, MAX_PER_MINUTE } from './limits';
import type { QuotaScope } from './open-transport';
import { quotaToday } from './quota';
import type { QuotaState } from './quota';
import { listSenders } from './senders';
import type { SenderSummary } from './senders';

/** The name of the foreign key that keeps a connection with senders from being deleted. */
const SENDER_CONNECTION_FK = 'senders_connection_id_mail_connections_id_fk';
const SECRET_COLUMN = 'secret_ciphertext';
const WEBHOOK_SECRET_COLUMN = 'webhook_secret_ciphertext';
const CALENDAR_DATE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
const DAYS_IN_LONGEST_MONTH = 31;
const MS_PER_DAY = 86_400_000;

type ConnectionKind = 'graph' | 'resend';

/** What the connection form sends; a secret that is `null` stays as it is. */
type ConnectionInput =
	| {
			kind: 'graph';
			name: string;
			tenantId: string;
			clientId: string;
			clientSecret: string | null;
			secretExpiresOn: string;
	  }
	| {
			kind: 'resend';
			name: string;
			apiKey: string | null;
			webhookSecret: string | null;
			perMinute: number;
			dailyLimit: number | null;
	  };

/** A connection in the list; it never carries a secret. */
interface ConnectionSummary {
	readonly id: string;
	readonly kind: ConnectionKind;
	readonly name: string;
	readonly secretExpiresOn: string | null;
	readonly disturbedSince: Date | null;
	readonly restriction: RestrictionResult | null;
	readonly perMinute: number | null;
	readonly dailyLimit: number | null;
	/** How many senders use the connection. */
	readonly senders: number;
	readonly version: number;
}

/** A connection for its page: the public identifiers and whether the secrets are stored. */
interface ConnectionDetail extends ConnectionSummary {
	readonly tenantId: string | null;
	readonly clientId: string | null;
	readonly hasWebhookSecret: boolean;
}

/**
 * Reads the connections with the number of their senders.
 *
 * @param db The database.
 * @param id Only this connection, or all.
 * @returns The connections by name.
 */
async function readConnections(db: Db, id?: string): Promise<ConnectionDetail[]> {
	const rows = await db
		.select({
			clientId: mailConnections.clientId,
			dailyLimit: mailConnections.dailyLimit,
			disturbedSince: mailConnections.disturbedSince,
			hasWebhookSecret: sql<boolean>`${mailConnections.webhookSecretCiphertext} is not null`,
			id: mailConnections.id,
			kind: mailConnections.kind,
			name: mailConnections.name,
			perMinute: mailConnections.perMinute,
			restriction: mailConnections.restriction,
			secretExpiresOn: mailConnections.secretExpiresOn,
			senders: count(senders.id),
			tenantId: mailConnections.tenantId,
			version: mailConnections.version,
		})
		.from(mailConnections)
		.leftJoin(senders, eq(senders.connectionId, mailConnections.id))
		.where(id === undefined ? undefined : eq(mailConnections.id, id))
		.groupBy(mailConnections.id)
		.orderBy(sql`lower(${mailConnections.name})`, mailConnections.name, mailConnections.id);
	return rows;
}

/**
 * Lists the connections by name.
 *
 * @param db The database.
 * @param actor Who asks; an admin.
 * @returns The connections with the number of their senders, without any secret.
 * @throws {ForbiddenError} For anybody but an admin.
 */
async function listConnections(db: Db, actor: Principal): Promise<ConnectionSummary[]> {
	assertAdmin(actor);
	const rows = await readConnections(db);
	return rows.map((row) => ({
		dailyLimit: row.dailyLimit,
		disturbedSince: row.disturbedSince,
		id: row.id,
		kind: row.kind,
		name: row.name,
		perMinute: row.perMinute,
		restriction: row.restriction,
		secretExpiresOn: row.secretExpiresOn,
		senders: row.senders,
		version: row.version,
	}));
}

/**
 * Loads one connection for its page.
 *
 * @param db The database.
 * @param actor Who asks; an admin.
 * @param id The connection.
 * @returns The connection, without any secret.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {ConnectionNotFoundError} When no connection has the id.
 */
async function getConnection(db: Db, actor: Principal, id: string): Promise<ConnectionDetail> {
	assertAdmin(actor);
	const [row] = await readConnections(db, id);
	if (row === undefined) throw new ConnectionNotFoundError();
	return row;
}

/**
 * A required text, trimmed.
 *
 * @param value What the admin typed.
 * @param field The field it belongs to.
 * @param max The longest length.
 * @returns The text.
 * @throws {ConnectionInvalidError} When it is empty or too long.
 */
function requiredText(value: string, field: ConnectionField, max: number): string {
	const trimmed = value.trim();
	if (trimmed === '' || trimmed.length > max) throw new ConnectionInvalidError(field);
	return trimmed;
}

/**
 * A secret that is typed anew, or null for the one that is stored.
 *
 * @param value What the admin typed, or null.
 * @param isRequired Whether a new row needs one.
 * @returns The secret, or null to keep the stored one.
 * @throws {ConnectionInvalidError} When a required one is missing or one is too long.
 */
function secretText(value: string | null, isRequired: boolean): string | null {
	const trimmed = value?.trim() ?? '';
	if (trimmed === '') {
		if (isRequired) throw new ConnectionInvalidError('secret');
		return null;
	}
	if (trimmed.length > MAX_CREDENTIAL_LENGTH) throw new ConnectionInvalidError('secret');
	return trimmed;
}

/**
 * A whole number in a range.
 *
 * @param value The number.
 * @param field The field it belongs to.
 * @param max The largest allowed value.
 * @returns The number.
 * @throws {ConnectionInvalidError} For anything else than an integer from 1 to `max`.
 */
function limit(value: number, field: ConnectionField, max: number): number {
	if (!Number.isInteger(value) || value < 1 || value > max) throw new ConnectionInvalidError(field);
	return value;
}

/**
 * A calendar date `YYYY-MM-DD` that exists.
 *
 * @param value The date as the form sends it.
 * @returns The date.
 * @throws {ConnectionInvalidError} For anything else.
 */
function calendarDate(value: string): string {
	const parts = CALENDAR_DATE.exec(value)?.groups;
	if (parts === undefined) throw new ConnectionInvalidError('secretExpiresOn');
	const day = Number(parts.day);
	const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, day));
	const exists =
		day <= DAYS_IN_LONGEST_MONTH &&
		date.getUTCFullYear() === Number(parts.year) &&
		date.getUTCMonth() === Number(parts.month) - 1 &&
		date.getUTCDate() === day;
	if (!exists) throw new ConnectionInvalidError('secretExpiresOn');
	return value;
}

/** The columns a checked input sets, with the secrets already encrypted. */
interface Columns {
	readonly name: string;
	readonly tenantId: string | null;
	readonly clientId: string | null;
	readonly secretExpiresOn: string | null;
	readonly perMinute: number | null;
	readonly dailyLimit: number | null;
	readonly secretCiphertext?: string;
	readonly webhookSecretCiphertext?: string;
}

/**
 * Encrypts a secret for its column of the row.
 *
 * @param secret The secret.
 * @param key The key of the secrets.
 * @param id The row.
 * @param column The column.
 * @returns The token.
 */
// oxlint-disable-next-line max-params -- the secret, the key and the place it is bound to
async function sealed(secret: string, key: CryptoKey, id: string, column: string): Promise<string> {
	return encryptSecret(secret, key, secretAad('mail_connections', id, column));
}

/**
 * Checks the Graph part of an input and encrypts its secret.
 *
 * @param input The input of a Graph connection.
 * @param id The id of the row.
 * @param isNew Whether the row is created: it needs its secret.
 * @param key The key of the secrets.
 * @returns The columns of the kind.
 */
// oxlint-disable-next-line max-params -- the input, the row, the mode and the key
async function graphColumns(
	input: Readonly<Extract<ConnectionInput, { kind: 'graph' }>>,
	id: string,
	isNew: boolean,
	key: CryptoKey,
): Promise<Omit<Columns, 'name'>> {
	const secret = secretText(input.clientSecret, isNew);
	return {
		clientId: requiredText(input.clientId, 'clientId', MAX_CREDENTIAL_LENGTH),
		dailyLimit: null,
		perMinute: null,
		secretExpiresOn: calendarDate(input.secretExpiresOn),
		tenantId: requiredText(input.tenantId, 'tenantId', MAX_CREDENTIAL_LENGTH),
		...(secret === null ? {} : { secretCiphertext: await sealed(secret, key, id, SECRET_COLUMN) }),
	};
}

/**
 * Checks the Resend part of an input and encrypts its secrets.
 *
 * @param input The input of a Resend connection.
 * @param id The id of the row.
 * @param isNew Whether the row is created: it needs its API key.
 * @param key The key of the secrets.
 * @returns The columns of the kind.
 */
// oxlint-disable-next-line max-params -- the input, the row, the mode and the key
async function resendColumns(
	input: Readonly<Extract<ConnectionInput, { kind: 'resend' }>>,
	id: string,
	isNew: boolean,
	key: CryptoKey,
): Promise<Omit<Columns, 'name'>> {
	const apiKey = secretText(input.apiKey, isNew);
	const webhookSecret = secretText(input.webhookSecret, false);
	return {
		clientId: null,
		dailyLimit:
			input.dailyLimit === null ? null : limit(input.dailyLimit, 'dailyLimit', MAX_DAILY_LIMIT),
		perMinute: limit(input.perMinute, 'perMinute', MAX_PER_MINUTE),
		secretExpiresOn: null,
		tenantId: null,
		...(apiKey === null ? {} : { secretCiphertext: await sealed(apiKey, key, id, SECRET_COLUMN) }),
		...(webhookSecret === null
			? {}
			: { webhookSecretCiphertext: await sealed(webhookSecret, key, id, WEBHOOK_SECRET_COLUMN) }),
	};
}

/**
 * Checks an input and encrypts its secrets for the row.
 *
 * @param input What the form sent.
 * @param id The id of the row, which the encrypted secrets are bound to.
 * @param isNew Whether the row is created: it needs its secret.
 * @param key The key of the secrets.
 * @returns The columns to write; a secret that was not typed is left out.
 * @throws {ConnectionInvalidError} When a value is missing or out of range.
 */
// oxlint-disable-next-line max-params -- the input, the row, the mode and the key
async function checkedColumns(
	input: Readonly<ConnectionInput>,
	id: string,
	isNew: boolean,
	key: CryptoKey,
): Promise<Columns> {
	const name = requiredText(input.name, 'name', MAX_NAME_LENGTH);
	const kindColumns =
		input.kind === 'graph'
			? await graphColumns(input, id, isNew, key)
			: await resendColumns(input, id, isNew, key);
	return { ...kindColumns, name };
}

/**
 * Logs a change of a connection with its id only.
 *
 * @param tx The transaction.
 * @param action What happened.
 * @param actor Who did it.
 * @param connectionId The connection.
 * @param details What else to log; never a secret.
 */
// oxlint-disable-next-line max-params -- the transaction, the action, the actor, the target and the details
async function logConnection(
	tx: Db,
	action: AuditAction,
	actor: Principal,
	connectionId: string,
	details?: Readonly<Record<string, unknown>>,
): Promise<void> {
	await writeAudit(tx, {
		action,
		actorUserId: actor.userId,
		details,
		target: `connection:${connectionId}`,
	});
}

/**
 * Creates a connection.
 *
 * @param db The database.
 * @param actor Who creates it; an admin.
 * @param input The form: a Graph connection needs its client secret, a Resend one its API key.
 * @param key The key of the secrets (`deriveSecretsKey(env.appSecret)`).
 * @returns The id of the connection.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {ConnectionInvalidError} When a value is missing or out of range.
 * @throws {ConnectionNameTakenError} When another connection has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function createConnection(
	db: Db,
	actor: Principal,
	input: Readonly<ConnectionInput>,
	key: CryptoKey,
): Promise<{ id: string }> {
	assertAdmin(actor);
	const id = crypto.randomUUID();
	const columns = await checkedColumns(input, id, true, key);
	const { secretCiphertext } = columns;
	if (secretCiphertext === undefined) throw new ConnectionInvalidError('secret');
	try {
		await db.transaction(async (tx) => {
			await tx.insert(mailConnections).values({
				...columns,
				createdByUserId: actor.userId,
				id,
				kind: input.kind,
				secretCiphertext,
				updatedByUserId: actor.userId,
			});
			await logConnection(tx, 'connection.created', actor, id, { kind: input.kind });
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new ConnectionNameTakenError();
		throw error;
	}
	return { id };
}

/**
 * Changes a connection. The row is locked and its version compared, so of two saves based on the
 * same version the second is refused. A secret that is `null` stays as it is; the kind cannot
 * change.
 *
 * @param db The database.
 * @param actor Who changes it; an admin.
 * @param id The connection.
 * @param input The form.
 * @param version The version the page loaded.
 * @param key The key of the secrets.
 * @returns The new version.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {ConnectionNotFoundError} When no connection has the id.
 * @throws {ConnectionChangedError} When somebody saved it since the page loaded it.
 * @throws {ConnectionInvalidError} When a value is missing or out of range, or the kind differs.
 * @throws {ConnectionNameTakenError} When another connection has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function updateConnection(
	db: Db,
	actor: Principal,
	id: string,
	input: Readonly<ConnectionInput>,
	version: number,
	key: CryptoKey,
): Promise<{ version: number }> {
	assertAdmin(actor);
	try {
		return await db.transaction(async (tx) => {
			const [row] = await tx
				.select({
					id: mailConnections.id,
					kind: mailConnections.kind,
					version: mailConnections.version,
				})
				.from(mailConnections)
				.where(eq(mailConnections.id, id))
				.for('update');
			if (row === undefined) throw new ConnectionNotFoundError();
			if (row.version !== version) throw new ConnectionChangedError();
			if (row.kind !== input.kind) throw new ConnectionInvalidError('kind');
			// The secrets are bound to the id of the locked row, not to the id the client sent.
			const columns = await checkedColumns(input, row.id, false, key);
			const next = version + 1;
			await tx
				.update(mailConnections)
				.set({ ...columns, updatedAt: new Date(), updatedByUserId: actor.userId, version: next })
				.where(and(eq(mailConnections.id, row.id), eq(mailConnections.version, version)));
			await logConnection(tx, 'connection.updated', actor, row.id, {
				secretChanged: columns.secretCiphertext !== undefined,
			});
			return { version: next };
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new ConnectionNameTakenError();
		throw error;
	}
}

/**
 * Deletes a connection no sender uses. The count is checked first; the restricting foreign key
 * answers for a sender that was added in the meantime.
 *
 * @param db The database.
 * @param actor Who deletes it; an admin.
 * @param id The connection.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {ConnectionNotFoundError} When no connection has the id.
 * @throws {ConnectionInUseError} When senders use it; the error says how many.
 */
async function deleteConnection(db: Db, actor: Principal, id: string): Promise<void> {
	assertAdmin(actor);
	const [used] = await db
		.select({ senders: count() })
		.from(senders)
		.where(eq(senders.connectionId, id));
	if ((used?.senders ?? 0) > 0) throw new ConnectionInUseError(used?.senders ?? 0);
	try {
		await db.transaction(async (tx) => {
			const deleted = await tx
				.delete(mailConnections)
				.where(eq(mailConnections.id, id))
				.returning({ id: mailConnections.id });
			if (deleted.length === 0) throw new ConnectionNotFoundError();
			await logConnection(tx, 'connection.deleted', actor, id);
		});
	} catch (error) {
		if (!isForeignKeyViolationOf(error, SENDER_CONNECTION_FK)) throw error;
		const [raced] = await db
			.select({ senders: count() })
			.from(senders)
			.where(eq(senders.connectionId, id));
		throw new ConnectionInUseError(Math.max(1, raced?.senders ?? 1));
	}
}

/** The queue of one sender: what waits, what is uncertain and what failed. */
interface QueueCounts {
	readonly open: number;
	readonly uncertain: number;
	readonly failed: number;
}

/** What the overview page shows: the connections and the senders with their numbers. */
interface SendingOverview {
	readonly connections: readonly (ConnectionSummary & { daysToExpiry: number | null })[];
	readonly senders: readonly (SenderSummary & QueueCounts & { quota: QuotaState })[];
}

/**
 * The entries of each sender that wait (planned or sending), are uncertain or failed.
 *
 * @param db The database.
 * @returns The numbers by sender id; a sender without such entries is missing.
 */
async function queueCounts(db: Db): Promise<Map<string, QueueCounts>> {
	const rows = await db
		.select({
			failed: sql<number>`count(*) filter (where ${outboxEntries.status} = 'failed')`.mapWith(
				Number,
			),
			open: sql<number>`count(*) filter (where ${outboxEntries.status} in ('planned', 'sending'))`.mapWith(
				Number,
			),
			senderId: outboxEntries.senderId,
			uncertain: sql<number>`count(*) filter (where ${outboxEntries.status} = 'uncertain')`.mapWith(
				Number,
			),
		})
		.from(outboxEntries)
		.where(inArray(outboxEntries.status, ['planned', 'sending', 'failed', 'uncertain']))
		.groupBy(outboxEntries.senderId);
	const byId = new Map<string, QueueCounts>();
	for (const { senderId, ...counts } of rows) {
		if (senderId !== null) byId.set(senderId, counts);
	}
	return byId;
}

/**
 * The quota scope of a sender: a Graph sender counts alone, a Resend connection for all its senders.
 *
 * @param sender The sender.
 * @returns The scope.
 */
function scopeOf(
	sender: Readonly<Pick<SenderSummary, 'connectionId' | 'connectionKind' | 'id'>>,
): QuotaScope {
	return sender.connectionKind === 'resend'
		? `connection:${sender.connectionId}`
		: `sender:${sender.id}`;
}

/**
 * Adds the whole days each secret has left, counted in club days.
 *
 * @param connections The connections.
 * @param now The instant.
 * @returns The connections with `daysToExpiry` (negative once expired; null without a date).
 */
function withDaysToExpiry(
	connections: readonly Readonly<ConnectionSummary>[],
	now: Date,
): SendingOverview['connections'][number][] {
	const today = Date.parse(todayInClubZone(now));
	const days = (expiresOn: string | null): number | null =>
		expiresOn === null ? null : Math.round((Date.parse(expiresOn) - today) / MS_PER_DAY);
	const result: SendingOverview['connections'][number][] = [];
	for (const connection of connections) {
		result.push({ ...connection, daysToExpiry: days(connection.secretExpiresOn) });
	}
	return result;
}

/**
 * The overview of the sending for admins: the connections with the days their secret has left,
 * the senders with their queue and today's count against the limit. It carries no recipient: the
 * admin role alone gives no access to contact data.
 *
 * @param db The database.
 * @param actor Who asks; an admin.
 * @param now The instant; its club day counts for the days and the quota.
 * @returns The connections and the senders.
 * @throws {ForbiddenError} For anybody but an admin.
 */
async function sendingOverview(db: Db, actor: Principal, now: Date): Promise<SendingOverview> {
	assertAdmin(actor);
	const [connections, senderList, counts] = await Promise.all([
		listConnections(db, actor),
		listSenders(db, actor),
		queueCounts(db),
	]);
	const noCounts: QueueCounts = { failed: 0, open: 0, uncertain: 0 };
	// One after the other: the quota queries may share a connection.
	const rows: SendingOverview['senders'][number][] = [];
	for (const sender of senderList) {
		// oxlint-disable-next-line no-await-in-loop -- see above
		const quota = await quotaToday(db, scopeOf(sender), now);
		rows.push({ ...sender, ...(counts.get(sender.id) ?? noCounts), quota });
	}
	return { connections: withDaysToExpiry(connections, now), senders: rows };
}

export {
	createConnection,
	deleteConnection,
	getConnection,
	listConnections,
	sendingOverview,
	updateConnection,
};
export type {
	ConnectionDetail,
	ConnectionInput,
	ConnectionKind,
	ConnectionSummary,
	QueueCounts,
	SendingOverview,
};
