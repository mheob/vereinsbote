/* oxlint-disable typescript/prefer-readonly-parameter-types -- Drizzle passes mutable table and relation builders to the schema callbacks */
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm/relations';
import { sql } from 'drizzle-orm/sql';

/*
 * The tables of Better Auth (user, session, account, verification) with the columns it expects,
 * plus the app's own user columns `is_admin` and `status`. Better Auth reads and writes these
 * through its Drizzle adapter; it can never set `is_admin` or `status` (see `createAuth`).
 */

/** `invited` until the first sign-in, then `active`; `disabled` users cannot sign in. */
export const userStatuses = ['invited', 'active', 'disabled'] as const;

export const user = pgTable(
	'user',
	{
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		/** Stored normalized (trimmed, lowercase), see `normalizeEmail`. */
		email: text('email').notNull(),
		emailVerified: boolean('email_verified').notNull().default(false),
		/** Users are created by the app only, Better Auth never inserts one. */
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		image: text('image'),
		isAdmin: boolean('is_admin').notNull().default(false),
		name: text('name').notNull(),
		status: text('status', { enum: userStatuses }).notNull().default('invited'),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('user_email_lower_idx').on(sql`lower(${table.email})`),
		check('user_status_check', sql`${table.status} in ('invited', 'active', 'disabled')`),
	],
);

export const session = pgTable(
	'session',
	{
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		id: text('id').primaryKey(),
		ipAddress: text('ip_address'),
		token: text('token').notNull().unique(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	(table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = pgTable(
	'account',
	{
		accessToken: text('access_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		accountId: text('account_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		id: text('id').primaryKey(),
		idToken: text('id_token'),
		password: text('password'),
		providerId: text('provider_id').notNull(),
		refreshToken: text('refresh_token'),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		scope: text('scope'),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	(table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = pgTable(
	'verification',
	{
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		value: text('value').notNull(),
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)],
);

// Better Auth joins users with their accounts and sessions through these relations; without
// them it cannot find the owner of a linked Microsoft account.
export const userRelations = relations(user, ({ many }) => ({
	accounts: many(account),
	sessions: many(session),
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, { fields: [account.userId], references: [user.id] }),
}));
