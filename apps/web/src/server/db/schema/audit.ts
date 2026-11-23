import { bigserial, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { user } from './auth';

/** Who did what and when. Never holds secrets or e-mail addresses in `details`. */
export const auditLog = pgTable('audit_log', {
	action: text('action').notNull(),
	/** Null for system actions and after the actor was deleted. */
	actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
	at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
	details: jsonb('details'),
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	target: text('target'),
});
