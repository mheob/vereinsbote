import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import { areas } from './areas';
import { user } from './auth';
import { occasions } from './occasions';

/** The file types a mail may carry (Design 10.2); the check below repeats them. */
const ATTACHMENT_TYPE_VALUES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/**
 * A file attached to the mails of a wave (Design 10.2). The bytes are in the object storage under
 * `attachments/<id>`, never served publicly. Before the wave is made `wave_id` is null: such a
 * file belongs to the occasion's open flow, and the tick removes it after one day. `wave_id` has
 * no foreign key yet; the task that adds the `waves` table adds it.
 */
export const attachments = pgTable(
	'attachments',
	{
		areaId: uuid('area_id')
			.notNull()
			.references(() => areas.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		/** 22 characters of base64url, see `newMediaId`. */
		id: text('id').primaryKey(),
		/** The safe file name the recipients see, at most 200 characters. */
		name: text('name').notNull(),
		/** Null once the occasion was removed: `attachmentCleanup` then removes the file at its next run. */
		occasionId: uuid('occasion_id').references(() => occasions.id, { onDelete: 'set null' }),
		size: integer('size').notNull(),
		type: text('type', { enum: ATTACHMENT_TYPE_VALUES }).notNull(),
		waveId: uuid('wave_id'),
	},
	(table) => [
		check(
			'attachments_type_check',
			sql`${table.type} in ('application/pdf', 'image/jpeg', 'image/png')`,
		),
		index('attachments_occasion_idx').on(table.occasionId),
		index('attachments_wave_idx').on(table.waveId),
	],
);
