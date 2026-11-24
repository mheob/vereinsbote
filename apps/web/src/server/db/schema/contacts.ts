import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	date,
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

import { CONTACT_KINDS, CUSTOM_FIELD_TYPES, GENDERS, PROTECTIONS } from '@/server/contacts/fields';

import { areas } from './areas';
import { user } from './auth';

/** `'member', 'partner'` as a SQL list for the checks. */
const kindList = sql.raw(CONTACT_KINDS.map((kind) => `'${kind}'`).join(', '));

/**
 * A member or a partner, one table for both kinds. Members are identified by their member
 * number; partners by a customer number or, without one, by their address. `contact_key`
 * joins the contact to its suppression and opt-outs, which are stored apart from it.
 */
export const contacts = pgTable(
	'contacts',
	{
		birthDate: date('birth_date', { mode: 'string' }),
		city: text('city'),
		/** `nr:<number>` or `email:<address>`, generated from the identifying columns. */
		contactKey: text('contact_key')
			.notNull()
			.generatedAlwaysAs(
				sql`case when kind = 'member' then 'nr:' || member_number when customer_number is not null then 'nr:' || customer_number else 'email:' || email end`,
			),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		/** Custom field id to value. */
		customValues: jsonb('custom_values')
			.$type<Record<string, string>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		customerNumber: text('customer_number'),
		/** Stored normalized, see `normalizeEmail`. */
		email: text('email'),
		entryDate: date('entry_date', { mode: 'string' }),
		exitDate: date('exit_date', { mode: 'string' }),
		firstName: text('first_name'),
		gender: text('gender', { enum: GENDERS }).notNull().default('unspecified'),
		groups: text('groups')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		id: uuid('id').primaryKey().defaultRandom(),
		kind: text('kind', { enum: CONTACT_KINDS }).notNull(),
		lastName: text('last_name'),
		memberNumber: text('member_number'),
		organization: text('organization'),
		postalCode: text('postal_code'),
		street: text('street'),
		tags: text('tags')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		check('contacts_kind_check', sql`${table.kind} in (${kindList})`),
		check(
			'contacts_gender_check',
			sql`${table.gender} in (${sql.raw(GENDERS.map((gender) => `'${gender}'`).join(', '))})`,
		),
		check(
			'contacts_member_number_check',
			sql`(${table.kind} = 'member') = (${table.memberNumber} is not null)`,
		),
		check(
			'contacts_customer_number_check',
			sql`${table.kind} = 'partner' or ${table.customerNumber} is null`,
		),
		check(
			'contacts_partner_identity_check',
			sql`${table.kind} = 'member' or ${table.customerNumber} is not null or ${table.email} is not null`,
		),
		uniqueIndex('contacts_member_number_idx')
			.on(table.memberNumber)
			.where(sql`${table.kind} = 'member'`),
		uniqueIndex('contacts_customer_number_idx')
			.on(table.customerNumber)
			.where(sql`${table.customerNumber} is not null`),
		index('contacts_kind_key_idx').on(table.kind, table.contactKey),
	],
);

/** A contact row as the database returns it. */
export type ContactRecord = typeof contacts.$inferSelect;

/** An extra field of one kind; its values live in `contacts.custom_values`. */
export const customFields = pgTable(
	'custom_fields',
	{
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		id: uuid('id').primaryKey().defaultRandom(),
		kind: text('kind', { enum: CONTACT_KINDS }).notNull(),
		name: text('name').notNull(),
		protection: text('protection', { enum: PROTECTIONS }).notNull().default('protected'),
		type: text('type', { enum: CUSTOM_FIELD_TYPES }).notNull(),
	},
	(table) => [
		check('custom_fields_kind_check', sql`${table.kind} in (${kindList})`),
		check(
			'custom_fields_type_check',
			sql`${table.type} in (${sql.raw(CUSTOM_FIELD_TYPES.map((type) => `'${type}'`).join(', '))})`,
		),
		check(
			'custom_fields_protection_check',
			sql`${table.protection} in (${sql.raw(PROTECTIONS.map((value) => `'${value}'`).join(', '))})`,
		),
		uniqueIndex('custom_fields_kind_name_idx').on(table.kind, sql`lower(${table.name})`),
	],
);

/**
 * The areas whose members see a protected field of a kind. Without rows a field follows the
 * area of its kind (`contact_settings`).
 */
export const protectedFieldAreas = pgTable(
	'protected_field_areas',
	{
		areaId: uuid('area_id')
			.notNull()
			.references(() => areas.id, { onDelete: 'cascade' }),
		/** A built-in protected field or `custom:<id>`. */
		fieldKey: text('field_key').notNull(),
		kind: text('kind', { enum: CONTACT_KINDS }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.kind, table.fieldKey, table.areaId] }),
		check('protected_field_areas_kind_check', sql`${table.kind} in (${kindList})`),
	],
);

/** The one settings row: the areas of the two kinds and the age after which an import is old. */
export const contactSettings = pgTable(
	'contact_settings',
	{
		id: boolean('id').primaryKey().default(true),
		membersAreaId: uuid('members_area_id').references(() => areas.id, { onDelete: 'restrict' }),
		partnersAreaId: uuid('partners_area_id').references(() => areas.id, { onDelete: 'restrict' }),
		staleImportWeeks: integer('stale_import_weeks').notNull().default(8),
	},
	(table) => [
		check('contact_settings_singleton_check', sql`${table.id}`),
		check(
			'contact_settings_stale_import_weeks_check',
			sql`${table.staleImportWeeks} between 1 and 52`,
		),
	],
);

/** Per kind: how often the stock changed, when an import was last confirmed and its mapping. */
export const importState = pgTable(
	'import_state',
	{
		kind: text('kind', { enum: CONTACT_KINDS }).primaryKey(),
		lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
		mapping: jsonb('mapping'),
		stockVersion: integer('stock_version').notNull().default(0),
	},
	(table) => [check('import_state_kind_check', sql`${table.kind} in (${kindList})`)],
);

/** A contact the club does not mail any more; matched by `contact_key`, so it survives re-imports. */
export const contactSuppressions = pgTable(
	'contact_suppressions',
	{
		contactKey: text('contact_key').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		kind: text('kind', { enum: CONTACT_KINDS }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.kind, table.contactKey] }),
		check('contact_suppressions_kind_check', sql`${table.kind} in (${kindList})`),
	],
);

/** A contact's objection to mail of one area or one occasion. */
export const contactOptOuts = pgTable(
	'contact_opt_outs',
	{
		areaId: uuid('area_id').references(() => areas.id, { onDelete: 'cascade' }),
		contactKey: text('contact_key').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		id: uuid('id').primaryKey().defaultRandom(),
		kind: text('kind', { enum: CONTACT_KINDS }).notNull(),
		/** No foreign key: the table of occasions comes in a later sub-plan. */
		occasionId: uuid('occasion_id'),
		scope: text('scope', { enum: ['area', 'occasion'] }).notNull(),
	},
	(table) => [
		check('contact_opt_outs_kind_check', sql`${table.kind} in (${kindList})`),
		check('contact_opt_outs_scope_check', sql`${table.scope} in ('area', 'occasion')`),
		check(
			'contact_opt_outs_target_check',
			sql`(${table.scope} = 'area' and ${table.areaId} is not null and ${table.occasionId} is null) or (${table.scope} = 'occasion' and ${table.occasionId} is not null and ${table.areaId} is null)`,
		),
		uniqueIndex('contact_opt_outs_area_idx')
			.on(table.kind, table.contactKey, table.areaId)
			.where(sql`${table.scope} = 'area'`),
	],
);
