import {
	check,
	index,
	integer,
	jsonb,
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
import { media } from './media';

/**
 * A global layout an admin imported: HTML with `{{content}}`, usable by every template. The
 * name is unique ignoring case; `version` is the optimistic lock of its form.
 */
export const layouts = pgTable(
	'layouts',
	{
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		html: text('html').notNull(),
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedByUserId: text('updated_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		version: integer('version').notNull().default(1),
	},
	(table) => [uniqueIndex('layouts_name_lower_idx').on(sql`lower(${table.name})`)],
);

/**
 * A mail template of an area. `body` holds the blocks and the layout choice, or the HTML of an
 * import (`templateBodySchema`); `shared_layout_id` mirrors the choice of a global layout, so a
 * layout in use cannot be deleted. The name is stored trimmed and unique in the area ignoring
 * case; `version` is the optimistic lock of the editor.
 */
export const templates = pgTable(
	'templates',
	{
		areaId: uuid('area_id')
			.notNull()
			.references(() => areas.id, { onDelete: 'restrict' }),
		body: jsonb('body').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		preheader: text('preheader').notNull().default(''),
		salutationForm: text('salutation_form', { enum: ['du', 'sie'] }).notNull(),
		/** One text per salutation case (`salutationTextsSchema`). */
		salutationTexts: jsonb('salutation_texts').notNull(),
		sharedLayoutId: uuid('shared_layout_id').references(() => layouts.id, {
			onDelete: 'restrict',
		}),
		subject: text('subject').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedByUserId: text('updated_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		version: integer('version').notNull().default(1),
	},
	(table) => [
		check('templates_salutation_form_check', sql`${table.salutationForm} in ('du', 'sie')`),
		uniqueIndex('templates_area_name_lower_idx').on(table.areaId, sql`lower(${table.name})`),
		index('templates_shared_layout_idx').on(table.sharedLayoutId),
	],
);

/**
 * The library images a template shows, set anew on every save. The foreign key on the image
 * keeps an image in use from being deleted.
 */
export const templateMedia = pgTable(
	'template_media',
	{
		mediaId: text('media_id')
			.notNull()
			.references(() => media.id, { onDelete: 'restrict' }),
		templateId: uuid('template_id')
			.notNull()
			.references(() => templates.id, { onDelete: 'cascade' }),
	},
	(table) => [
		primaryKey({ columns: [table.templateId, table.mediaId] }),
		index('template_media_media_idx').on(table.mediaId),
	],
);
