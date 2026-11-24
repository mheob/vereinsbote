import { eq } from 'drizzle-orm';

import type { Db } from './db/client';
import { systemState } from './db/schema';

type StateKey =
	| 'last_tick'
	| 'setup_completed_at'
	| 'setup_session_opened_at'
	| 'stale_import_warned_at'
	| 'tick_lock';

/**
 * Reads a state value.
 *
 * @param db The database.
 * @param key The state key.
 * @returns The stored value, or null when the key was never set.
 */
async function getState<T>(db: Db, key: StateKey): Promise<T | null> {
	const [row] = await db.select().from(systemState).where(eq(systemState.key, key));
	// The caller names the shape it stored under this key.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- jsonb has no static type
	return row ? (row.value as T) : null;
}

/**
 * Stores a state value, replacing an existing one.
 *
 * @param db The database.
 * @param key The state key.
 * @param value Any JSON-serializable value.
 */
async function setState(db: Db, key: StateKey, value: unknown): Promise<void> {
	await db
		.insert(systemState)
		.values({ key, value })
		.onConflictDoUpdate({
			set: { updatedAt: new Date(), value },
			target: systemState.key,
		});
}

export { getState, setState };
export type { StateKey };
