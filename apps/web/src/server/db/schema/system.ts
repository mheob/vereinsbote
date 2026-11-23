import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Key-value store for instance-wide state such as the setup marker and the tick lock. */
export const systemState = pgTable('system_state', {
	key: text('key').primaryKey(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	value: jsonb('value').notNull(),
});
