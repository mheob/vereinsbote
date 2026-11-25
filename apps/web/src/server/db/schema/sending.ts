import {
	boolean,
	check,
	date,
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
