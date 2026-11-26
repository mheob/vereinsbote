import {
	boolean,
	check,
	date,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import { areas } from './areas';
import { user } from './auth';

/** Where an outbox entry comes from: a wave of sub-plan 4b (`source_id` is the wave). */
const OUTBOX_SOURCES = ['wave'] as const;
/** `personal` mails go before `group` mails and keep their reserve of the daily limit (decision 5). */
const OUTBOX_PRIORITIES = ['personal', 'group'] as const;
/** The states of an entry (Design 8.1). */
const OUTBOX_STATUSES = [
	'planned',
	'sending',
	'sent',
	'bounced',
	'failed',
	'skipped',
	'cancelled',
	'uncertain',
] as const;

/**
 * The credentials for one mail provider (Design 6): Microsoft Graph or Resend. Several senders
 * share one connection. The secrets are stored encrypted (`secretAad('mail_connections', id,
 * '<column>')`) and never leave the server. `restriction` is the result of the last restriction
 * test (Graph only), `disturbedSince` the time the provider first refused the credentials.
 * `perMinute` and `dailyLimit` are the limits of a Resend account; Graph senders carry their own.
 */
export const mailConnections = pgTable(
	'mail_connections',
	{
		clientId: text('client_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		dailyLimit: integer('daily_limit'),
		disturbedCode: text('disturbed_code'),
		disturbedSince: timestamp('disturbed_since', { withTimezone: true }),
		id: uuid('id').primaryKey().defaultRandom(),
		kind: text('kind', { enum: ['graph', 'resend'] }).notNull(),
		name: text('name').notNull(),
		perMinute: integer('per_minute'),
		restriction: text('restriction', { enum: ['readable', 'restricted', 'unknown'] }),
		restrictionCheckedAt: timestamp('restriction_checked_at', { withTimezone: true }),
		secretCiphertext: text('secret_ciphertext').notNull(),
		secretExpiresOn: date('secret_expires_on', { mode: 'string' }),
		tenantId: text('tenant_id'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedByUserId: text('updated_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		version: integer('version').notNull().default(1),
		webhookSecretCiphertext: text('webhook_secret_ciphertext'),
	},
	(table) => [
		uniqueIndex('mail_connections_name_lower_idx').on(sql`lower(${table.name})`),
		check('mail_connections_kind_check', sql`${table.kind} in ('graph', 'resend')`),
		check(
			'mail_connections_restriction_check',
			sql`${table.restriction} is null or ${table.restriction} in ('readable', 'restricted', 'unknown')`,
		),
	],
);

/**
 * A sender address of the club. `perMinute` and `dailyLimit` are set for Graph senders only, and
 * `archiveBcc` for Resend senders only. At most one sender has `isSystem`: it sends the system
 * mails.
 */
export const senders = pgTable(
	'senders',
	{
		archiveBcc: text('archive_bcc'),
		connectionId: uuid('connection_id')
			.notNull()
			.references(() => mailConnections.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		dailyLimit: integer('daily_limit'),
		displayName: text('display_name').notNull(),
		email: text('email').notNull(),
		id: uuid('id').primaryKey().defaultRandom(),
		isSystem: boolean('is_system').notNull().default(false),
		perMinute: integer('per_minute'),
		replyTo: text('reply_to'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedByUserId: text('updated_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		version: integer('version').notNull().default(1),
	},
	(table) => [
		uniqueIndex('senders_email_lower_idx').on(sql`lower(${table.email})`),
		uniqueIndex('senders_single_system_idx')
			.on(table.isSystem)
			.where(sql`${table.isSystem}`),
	],
);

/** The areas a sender is released to; a sender without a row here serves system mails only. */
export const senderAreas = pgTable(
	'sender_areas',
	{
		areaId: uuid('area_id')
			.notNull()
			.references(() => areas.id, { onDelete: 'cascade' }),
		senderId: uuid('sender_id')
			.notNull()
			.references(() => senders.id, { onDelete: 'cascade' }),
	},
	(table) => [primaryKey({ columns: [table.senderId, table.areaId] })],
);

/**
 * One mail to one recipient (Design 8). The outbox step takes an entry with one statement
 * (`sending`), sends it and stores the outcome. `message_id` is made at the first take and kept
 * for every retry (Resend's idempotency, bounce matching); `recipient` is the address the mail went
 * to. The sender may be deleted once no entry is open (`deleteSender`); sent entries keep their
 * history without it.
 */
export const outboxEntries = pgTable(
	'outbox_entries',
	{
		attempts: integer('attempts').notNull().default(0),
		claimedAt: timestamp('claimed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		/** When the admins' digest reported the entry as failed or uncertain; null until then. */
		digestedAt: timestamp('digested_at', { withTimezone: true }),
		id: uuid('id').primaryKey().defaultRandom(),
		lastErrorCode: text('last_error_code'),
		messageId: text('message_id'),
		nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
		notBefore: timestamp('not_before', { withTimezone: true }).notNull().defaultNow(),
		priority: text('priority', { enum: OUTBOX_PRIORITIES }).notNull(),
		providerId: text('provider_id'),
		recipient: text('recipient'),
		senderId: uuid('sender_id').references(() => senders.id, { onDelete: 'set null' }),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		source: text('source', { enum: OUTBOX_SOURCES }).notNull(),
		sourceId: uuid('source_id').notNull(),
		status: text('status', { enum: OUTBOX_STATUSES }).notNull().default('planned'),
	},
	(table) => [
		check('outbox_entries_source_check', sql`${table.source} in ('wave')`),
		check('outbox_entries_priority_check', sql`${table.priority} in ('personal', 'group')`),
		check(
			'outbox_entries_status_check',
			sql`${table.status} in ('planned', 'sending', 'sent', 'bounced', 'failed', 'skipped', 'cancelled', 'uncertain')`,
		),
		index('outbox_entries_status_not_before_idx').on(table.status, table.notBefore),
		index('outbox_entries_sender_status_idx').on(table.senderId, table.status),
		uniqueIndex('outbox_entries_message_id_idx').on(table.messageId),
		index('outbox_entries_provider_id_idx').on(table.providerId),
	],
);

/**
 * The mails a quota scope sent per club day (decision 4): `sender:<id>` for Graph, `connection:<id>`
 * for Resend. Counted when the provider accepts a mail, system and test mails included.
 */
export const sendQuotaDays = pgTable(
	'send_quota_days',
	{
		count: integer('count').notNull().default(0),
		day: date('day', { mode: 'string' }).notNull(),
		scope: text('scope').notNull(),
	},
	(table) => [primaryKey({ columns: [table.scope, table.day] })],
);

/**
 * A quota scope the provider stopped for a while (ruling R5): after a quota refusal nothing of
 * the scope is sent until `paused_until`; then one entry tests whether the provider takes mails
 * again, and its acceptance removes the row. Resend counts its quota over a rolling 24 hours.
 */
export const sendScopePauses = pgTable('send_scope_pauses', {
	code: text('code').notNull(),
	pausedUntil: timestamp('paused_until', { withTimezone: true }).notNull(),
	scope: text('scope').primaryKey(),
});
