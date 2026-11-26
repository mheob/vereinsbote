import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import type { SalutationTexts } from '@/mail/placeholders/salutation';
import type { CompiledMail } from '@/mail/render/compile';
import { CONTACT_KINDS } from '@/server/contacts/fields';
import type { OccasionKind } from '@/server/occasions/limits';

import { areas } from './areas';
import { user } from './auth';
/*
 * Outbox entries point to their wave and a wave's contacts to their entry, so this module and
 * `./sending` (through `./occasions`) import each other. Drizzle reads a reference through its
 * callback only after every module has loaded, so the cycle is safe as long as nothing of the
 * other modules is used while this one loads: only `references(() => …)` may name them.
 */
// oxlint-disable-next-line import/no-cycle -- see above
import { occasions } from './occasions';
// oxlint-disable-next-line import/no-cycle -- see above
import { outboxEntries, senders } from './sending';

/**
 * One sending of an occasion (Design 11): made by a confirmation, with the template compiled at
 * that moment (`compiled`, `salutation_texts`), so later changes of the template, the brand or the
 * layout touch no wave. Its mails are the outbox entries with its `wave_id`. `request_id` is the
 * key of the flow that made it (plan decision 18): a second confirmation of the same flow finds the
 * wave instead of making another. `template_id` and `template_version` only record what was
 * compiled; the template may be gone later. `not_before` is null for a wave sent at once.
 */
export const waves = pgTable(
	'waves',
	{
		areaId: uuid('area_id')
			.notNull()
			.references(() => areas.id, { onDelete: 'restrict' }),
		compiled: jsonb('compiled').$type<CompiledMail>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		id: uuid('id').primaryKey().defaultRandom(),
		/** A copy of the occasion's kind when the wave was made; typed, not `enum`, see the imports. */
		kind: text('kind').$type<OccasionKind>().notNull(),
		notBefore: timestamp('not_before', { withTimezone: true }),
		occasionId: uuid('occasion_id')
			.notNull()
			.references(() => occasions.id, { onDelete: 'restrict' }),
		requestId: uuid('request_id').notNull().unique(),
		salutationTexts: jsonb('salutation_texts').$type<SalutationTexts>().notNull(),
		senderId: uuid('sender_id').references(() => senders.id, { onDelete: 'set null' }),
		stoppedAt: timestamp('stopped_at', { withTimezone: true }),
		stoppedByUserId: text('stopped_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		templateId: uuid('template_id').notNull(),
		templateVersion: integer('template_version').notNull(),
		/** Whether the mails carry the unsubscribe link (the occasion's setting at the time). */
		unsubscribe: boolean('unsubscribe').notNull(),
	},
	(table) => [
		check('waves_kind_check', sql`${table.kind} in ('personal', 'circular')`),
		index('waves_occasion_idx').on(table.occasionId, table.createdAt),
		index('waves_area_idx').on(table.areaId, table.createdAt),
	],
);

/**
 * The contacts of an outbox entry of a wave as they were at the confirmation: one for a personal
 * mail, every merged contact of the address for a circular, in the order of Design 11.2
 * (`position` 0 fills the mail). `contact_id` has no foreign key: an import may delete the contact,
 * and the outbox then skips it before sending (Design 11.3).
 */
export const waveContacts = pgTable(
	'wave_contacts',
	{
		contactId: uuid('contact_id'),
		contactKey: text('contact_key').notNull(),
		/** The address at the confirmation, normalized. */
		email: text('email').notNull(),
		entryId: uuid('entry_id')
			.notNull()
			.references(() => outboxEntries.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: CONTACT_KINDS }).notNull(),
		position: integer('position').notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.entryId, table.position] }),
		check('wave_contacts_kind_check', sql`${table.kind} in ('member', 'partner')`),
	],
);
