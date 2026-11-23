import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// oxlint-disable-next-line import/no-namespace -- Drizzle needs the whole schema module
import * as schema from './schema';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function ignorePoolError(): void {
	// Nothing to do, see the comment at the pool.
}

/**
 * Opens a database connection with the given driver.
 *
 * `pg` is imported dynamically, so it never ends up in the Cloudflare bundle.
 *
 * @param databaseUrl The PostgreSQL connection string.
 * @param driver `neon` (WebSocket pool, Vercel and Cloudflare) or `pg` (node-postgres, Node/Docker).
 * @returns The Drizzle client.
 */
async function createDb(databaseUrl: string, driver: 'neon' | 'pg'): Promise<Db> {
	if (driver === 'pg') {
		const [{ drizzle }, { default: pg }] = await Promise.all([
			import('drizzle-orm/node-postgres'),
			import('pg'),
		]);
		const pool = new pg.Pool({ connectionString: databaseUrl });
		// An idle client that loses its connection emits `error`; unhandled, that kills the process.
		// The pool drops the client, and the next query opens a new one.
		pool.on('error', ignorePoolError);
		return drizzle(pool, { schema });
	}
	const [{ drizzle }, { Pool }] = await Promise.all([
		import('drizzle-orm/neon-serverless'),
		import('@neondatabase/serverless'),
	]);
	const pool = new Pool({ connectionString: databaseUrl });
	pool.on('error', ignorePoolError);
	return drizzle(pool, { schema });
}

export { createDb };
export type { Db };
