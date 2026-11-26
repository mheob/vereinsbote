import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import { areas } from './areas';
import { user } from './auth';
import { senders } from './sending';
import { templates } from './templates';

/** The kinds of an occasion (Design 9): `personal` mails go per contact, `circular` per address. */
const OCCASION_KINDS = ['personal', 'circular'] as const;
/** The triggers of an occasion; sub-plan 5 adds the date rule. */
const OCCASION_TRIGGERS = ['manual'] as const;

/**
 * The name Drizzle gives the foreign key of `template_id` (`<table>_<column>_<target>_<column>_fk`);
 * `deleteTemplate` recognizes its violation by it.
 */
const OCCASION_TEMPLATE_FK = 'occasions_template_id_templates_id_fk';
/** The name Drizzle gives the foreign key of `sender_id`. */
const OCCASION_SENDER_FK = 'occasions_sender_id_senders_id_fk';

/**
 * An occasion of an area (Design 9): a recurring kind of mail („Einladungen“), each event a new
 * wave. It uses a template of its own area and a sender released to that area. The name is
 * stored trimmed and unique in the area ignoring case; `archived_at` marks an occasion with
 * waves that was removed (it keeps its history and its opt-outs); `version` is the optimistic
 * lock of its form. Template and sender cannot be deleted while an occasion uses them.
 */
export const occasions = pgTable(
	'occasions',
	{
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		areaId: uuid('area_id')
			.notNull()
			.references(() => areas.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		id: uuid('id').primaryKey().defaultRandom(),
		kind: text('kind', { enum: OCCASION_KINDS }).notNull(),
		name: text('name').notNull(),
		senderId: uuid('sender_id')
			.notNull()
			.references(() => senders.id, { onDelete: 'restrict' }),
		templateId: uuid('template_id')
			.notNull()
			.references(() => templates.id, { onDelete: 'restrict' }),
		trigger: text('trigger', { enum: OCCASION_TRIGGERS }).notNull().default('manual'),
		unsubscribe: boolean('unsubscribe').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedByUserId: text('updated_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		version: integer('version').notNull().default(1),
	},
	(table) => [
		check('occasions_kind_check', sql`${table.kind} in ('personal', 'circular')`),
		check('occasions_trigger_check', sql`${table.trigger} in ('manual')`),
		uniqueIndex('occasions_area_name_lower_idx').on(table.areaId, sql`lower(${table.name})`),
		index('occasions_template_idx').on(table.templateId),
		index('occasions_sender_idx').on(table.senderId),
	],
);

export { OCCASION_KINDS, OCCASION_SENDER_FK, OCCASION_TEMPLATE_FK, OCCASION_TRIGGERS };
