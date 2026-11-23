import { definePlugin } from 'nitro';

import { applyMigrations } from '@/server/db/apply-migrations';
import { bundledMigrations } from '@/server/db/bundled-migrations';
import { openDb } from '@/server/db/client';
import { EnvError, parseEnv } from '@/server/env';
import type { Env } from '@/server/env';
import { errorLabel, errorLabelWithCause } from '@/server/error-label';
import { startTickInterval } from '@/server/tick/interval';
import { tickSteps } from '@/server/tick/steps';
import { runTick } from '@/server/tick/tick';

import { createTickPool } from './tick-pool';

/*
 * A Nitro runtime plugin of the Node build (`plugins` in `vite.config.ts`). Nitro runs it once
 * when the server starts, before the first request; TanStack Start's own server entry would not
 * do, Nitro loads it lazily on the first request, so an idle server would never tick. The plugin
 * is async: Nitro holds every request until it has finished, so the migrations run before the
 * server serves (Spec 8), on every Node deployment, with or without Docker.
 */

/**
 * Reads the environment for the migrations and the interval.
 *
 * @returns The environment, or null when it is invalid (the requests report that as well).
 */
function readEnv(): Env | null {
	try {
		// oxlint-disable-next-line node/no-process-env -- the platform provides its settings here.
		return parseEnv({ ...process.env });
	} catch (error) {
		// EnvError names the variables only, never their values.
		const reason = error instanceof EnvError ? error.message : errorLabel(error);
		// oxlint-disable-next-line no-console -- without a valid environment there is nothing to run
		console.error('migrations and tick interval not started', reason);
		return null;
	}
}

/**
 * Applies the pending migrations, which are part of the bundle, over a connection of its own.
 *
 * @param databaseUrl The PostgreSQL connection string.
 */
async function migrate(databaseUrl: string): Promise<void> {
	const { db, end } = await openDb(databaseUrl, 'pg');
	try {
		await applyMigrations(db, await bundledMigrations());
	} finally {
		await end();
	}
}

/*
 * Migrates the database, then runs a tick every `TICK_INTERVAL_MS` (and follow-up ticks right
 * away while work is left, see `startTickInterval`). On shutdown, Nitro's `close` hook stops the
 * interval and ends the pool. When the migrations fail, the process exits: a server on an
 * outdated schema must not serve, and the exit lets the container runtime or process manager
 * report and restart it.
 */
export default definePlugin(async (nitroApp) => {
	const env = readEnv();
	if (env === null) return;
	try {
		await migrate(env.databaseUrl);
	} catch (error) {
		// oxlint-disable-next-line no-console -- names or codes only (Drizzle wraps the driver's error), the message may carry connection details
		console.error('migrations failed, server stops', errorLabelWithCause(error));
		// oxlint-disable-next-line node/no-process-exit, unicorn/no-process-exit -- see above, the server must not serve without its schema
		process.exit(1);
	}
	const pool = createTickPool(async () => openDb(env.databaseUrl, 'pg'));
	const stop = startTickInterval({
		intervalMs: env.tickIntervalMs,
		async run() {
			const { db } = await pool.open();
			return runTick({ db, env, steps: tickSteps });
		},
	});
	// oxlint-disable-next-line typescript/strict-void-return -- Nitro awaits a promise a `close` hook returns, though the hook type says void
	nitroApp.hooks.hook('close', async () => {
		stop();
		await pool.close();
	});
});
