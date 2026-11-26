import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import { CONTACT_KINDS } from '@/server/contacts/fields';

import { mailConnections, outboxEntries } from './sending';

/** Where a hard bounce was reported: Graph's inbox or Resend's webhook (Design 13). */
const BOUNCE_SOURCES = ['graph', 'resend'] as const;

/**
 * The mark „E-Mail ungültig“ (Design 13): a hard bounce of a contact's address. Like a suppression
 * it hangs on kind and `contact_key`, and on the address: when an import brings another address,
 * the mark no longer applies. `entry_id` is the outbox entry that bounced, while it exists.
 */
export const contactBounces = pgTable(
	'contact_bounces',
	{
		contactKey: text('contact_key').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		/** The address that bounced, normalized. */
		email: text('email').notNull(),
		entryId: uuid('entry_id').references(() => outboxEntries.id, { onDelete: 'set null' }),
		kind: text('kind', { enum: CONTACT_KINDS }).notNull(),
		source: text('source', { enum: BOUNCE_SOURCES }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.kind, table.contactKey, table.email] }),
		check('contact_bounces_kind_check', sql`${table.kind} in ('member', 'partner')`),
		check('contact_bounces_source_check', sql`${table.source} in ('graph', 'resend')`),
		// The markings of an entry (its area decides who clears them), and the `set null` of a
		// deleted entry.
		index('contact_bounces_entry_idx').on(table.entryId),
	],
);

/**
 * The bounce reports (NDR) of a Graph connection's mailboxes that the tick has processed (Design
 * 13): each report once, also when the query lists it again. `report_id` is Graph's message id.
 */
export const processedReports = pgTable(
	'processed_reports',
	{
		connectionId: uuid('connection_id')
			.notNull()
			.references(() => mailConnections.id, { onDelete: 'cascade' }),
		processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
		reportId: text('report_id').notNull(),
	},
	(table) => [primaryKey({ columns: [table.connectionId, table.reportId] })],
);

/**
 * The events of Resend's webhook that the app has processed (Design 17), by their Svix id: a
 * retry or a replay of an event changes nothing.
 */
export const webhookEvents = pgTable('webhook_events', {
	id: text('id').primaryKey(),
	receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export { BOUNCE_SOURCES };
