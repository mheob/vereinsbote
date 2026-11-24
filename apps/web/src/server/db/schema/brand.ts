import { check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import { user } from './auth';

/**
 * The corporate design of the club: one row, `id = 1`, absent until an admin saves the first
 * time. `settings` is checked against `brandSchema` on every write; `version` is the optimistic
 * lock of the admin form.
 */
export const brandSettings = pgTable(
	'brand_settings',
	{
		id: integer('id').primaryKey().default(1),
		settings: jsonb('settings').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedByUserId: text('updated_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		version: integer('version').notNull().default(1),
	},
	(table) => [check('brand_settings_single_row_check', sql`${table.id} = 1`)],
);
