/* oxlint-disable typescript/prefer-readonly-parameter-types -- Drizzle passes mutable table builders to the schema callbacks */
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

import { user } from './auth';

/** The access levels, lowest first; each level includes the ones below it. */
export const accessLevels = ['read', 'edit', 'send'] as const;

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
