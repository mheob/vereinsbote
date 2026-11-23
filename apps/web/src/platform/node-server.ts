import { createDb } from '@/server/db/client';
import type { Db } from '@/server/db/client';
import { EnvError, parseEnv } from '@/server/env';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';
import { startTickInterval } from '@/server/tick/interval';
import { tickSteps } from '@/server/tick/steps';
import { runTick } from '@/server/tick/tick';

/*
 * The Nitro server entry of the Node build (`serverEntry` in `vite.config.ts`). Nitro imports it
 * once at startup; it has no default export, so every request falls through to TanStack Start's
 * handler unchanged. TanStack Start's own entry would not do: Nitro loads it lazily on the first
 * request, so an idle server would never tick.
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

/**
 * Runs a tick every `TICK_INTERVAL_MS`. The ticks share a pool of their own, created on the first
 * tick; a pool connects per query and recovers from lost connections by itself.
 */
function startNodeTicks(): void {
	const env = readEnv();
	if (env === null) return;
	const state: { db?: Promise<Db> } = {};
	startTickInterval({
		intervalMs: env.tickIntervalMs,
		async run() {
			state.db ??= createDb(env.databaseUrl, 'pg');
			return runTick({ db: await state.db, env, steps: tickSteps });
		},
	});
}

startNodeTicks();
