import { definePlugin } from 'nitro';

import { openDb } from '@/server/db/client';
import { EnvError, parseEnv } from '@/server/env';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';
import { startTickInterval } from '@/server/tick/interval';
import { tickSteps } from '@/server/tick/steps';
import { runTick } from '@/server/tick/tick';

import { createTickPool } from './tick-pool';

/*
 * A Nitro runtime plugin of the Node build (`plugins` in `vite.config.ts`). Nitro runs it once
 * when the server starts, before the first request; TanStack Start's own server entry would not
 * do, Nitro loads it lazily on the first request, so an idle server would never tick.
 */

/**
 * Reads the environment for the interval.
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
		console.error('tick interval not started', reason);
		return null;
	}
}

/*
 * Runs a tick every `TICK_INTERVAL_MS` (and follow-up ticks right away while work is left, see
 * `startTickInterval`). On shutdown, Nitro's `close` hook stops the interval and ends the pool.
 */
export default definePlugin((nitroApp) => {
	const env = readEnv();
	if (env === null) return;
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
