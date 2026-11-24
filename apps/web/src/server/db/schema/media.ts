import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';

import { areas } from './areas';
import { user } from './auth';

/**
 * A stored image: a brand logo (`brand`) or an image of an area's library (`library`). The bytes
 * are in the object storage under `media/<id>`; the id is also the unguessable part of the
 * image's URL.
 */
export const media = pgTable(
	'media',
	{
		/** Null for a brand image, the owning area for a library image. */
		areaId: uuid('area_id').references(() => areas.id, { onDelete: 'restrict' }),
		bytes: integer('bytes').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		height: integer('height').notNull(),
		/** 22 characters of base64url, see `newMediaId`. */
		id: text('id').primaryKey(),
		/** The uploaded file's name without path, at most 200 characters. */
		name: text('name').notNull(),
		purpose: text('purpose', { enum: ['brand', 'library'] }).notNull(),
		type: text('type', { enum: ['jpeg', 'png'] }).notNull(),
		width: integer('width').notNull(),
	},
	(table) => [
		check('media_purpose_check', sql`${table.purpose} in ('brand', 'library')`),
		check('media_type_check', sql`${table.type} in ('jpeg', 'png')`),
		check('media_area_check', sql`(${table.purpose} = 'library') = (${table.areaId} is not null)`),
	],
);
