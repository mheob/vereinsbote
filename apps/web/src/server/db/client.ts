import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import { logPoolError } from './pool-error';
// oxlint-disable-next-line import/no-namespace -- Drizzle needs the whole schema module
import * as schema from './schema';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

interface DbHandle {
	db: Db;
	/** Closes the pool. */
	end: () => Promise<void>;
}

interface OpenDbOptions {
	/**
	 * `DEV_NEON_WS_PROXY`: a local Neon WebSocket proxy (`host:port/path`) in front of a local
	 * PostgreSQL, for the `neon` driver in local development. Spoken to over plain WebSocket.
	 */
	readonly devNeonWsProxy?: string | null;
}

async function openNeonDb(databaseUrl: string, devNeonWsProxy: string | null): Promise<DbHandle> {
	const [{ drizzle }, { Pool, neonConfig }] = await Promise.all([
		import('drizzle-orm/neon-serverless'),
		import('@neondatabase/serverless'),
	]);
	if (devNeonWsProxy !== null) {
		// Neon's settings for its own WebSocket proxy run locally (`wsproxy`): no TLS, and no
		// pipelined connect, which only works with Neon's cleartext password flow.
		neonConfig.wsProxy = devNeonWsProxy;
		neonConfig.useSecureWebSocket = false;
		neonConfig.pipelineTLS = false;
		neonConfig.pipelineConnect = false;
	}
	const pool = new Pool({ connectionString: databaseUrl });
	pool.on('error', logPoolError);
	return { db: drizzle(pool, { schema }), end: async () => pool.end() };
}

/**
 * Opens a database connection with the given driver.
 *
 * The `pg` branch is removed at build time on Cloudflare (build constant), so `pg` never ends up
 * in that bundle.
 *
 * @param databaseUrl The PostgreSQL connection string.
 * @param driver `neon` (WebSocket pool, Vercel and Cloudflare) or `pg` (Node/Docker).
 * @param options Development settings of the `neon` driver.
 * @returns The Drizzle client and a function that closes its pool.
 */
async function openDb(
	databaseUrl: string,
	driver: 'neon' | 'pg',
	options: OpenDbOptions = {},
): Promise<DbHandle> {
	if (driver === 'pg') {
		if (import.meta.env.VITE_VB_PLATFORM === 'cloudflare') {
			throw new Error('The pg driver is not available on Cloudflare.');
		}
		const { openPgDb } = await import('./pg-client');
		return openPgDb(databaseUrl);
	}
	return openNeonDb(databaseUrl, options.devNeonWsProxy ?? null);
}

/**
 * Opens a database connection with the given driver.
 *
 * @param databaseUrl The PostgreSQL connection string.
 * @param driver `neon` or `pg`, see `openDb`.
 * @returns The Drizzle client.
 */
async function createDb(databaseUrl: string, driver: 'neon' | 'pg'): Promise<Db> {
	const { db } = await openDb(databaseUrl, driver);
	return db;
}

export { createDb, openDb };
export type { Db, DbHandle, OpenDbOptions };
