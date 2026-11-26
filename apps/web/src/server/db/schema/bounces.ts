import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import { CONTACT_KINDS } from '@/server/contacts/fields';

import { outboxEntries } from './sending';

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
	],
);

export { BOUNCE_SOURCES };
