import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { DbHandle } from './client';
import { logPoolErrorsUntilEnd } from './pool-error';
// oxlint-disable-next-line import/no-namespace -- Drizzle needs the whole schema module
import * as schema from './schema';

/**
 * Opens a node-postgres pool. Kept in its own module so only the Node path ever loads `pg`.
 *
 * @param databaseUrl The PostgreSQL connection string.
 * @returns The Drizzle client and a function that closes the pool.
 */
function openPgDb(databaseUrl: string): DbHandle {
	const pool = new Pool({ connectionString: databaseUrl });
	return { db: drizzle(pool, { schema }), end: logPoolErrorsUntilEnd(pool) };
}

export { openPgDb };
