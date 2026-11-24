import {
	check,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import { accessLevels } from '@/server/permissions/levels';

import { user } from './auth';

/** A mailing area, e.g. "Finanzen". The name is unique ignoring case and stored trimmed. */
export const areas = pgTable(
	'areas',
	{
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
	},
	(table) => [uniqueIndex('areas_name_lower_idx').on(sql`lower(${table.name})`)],
);

/** The access level of one user in one area; no row means no access. */
export const areaMemberships = pgTable(
	'area_memberships',
	{
		areaId: uuid('area_id')
			.notNull()
			.references(() => areas.id, { onDelete: 'cascade' }),
		level: text('level', { enum: accessLevels }).notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.areaId] }),
		check('area_memberships_level_check', sql`${table.level} in ('read', 'edit', 'send')`),
	],
);
