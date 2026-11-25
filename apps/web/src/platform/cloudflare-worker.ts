import handler from '@tanstack/react-start/server-entry';

import { openDb } from '@/server/db/client';
import { parseEnv } from '@/server/env';
import { errorLabel } from '@/server/error-label';
import { openStorage } from '@/server/storage/open-storage';
import { tickSteps } from '@/server/tick/steps';
import { runTick } from '@/server/tick/tick';

import { variablesOf } from './bindings';
import type { Bindings } from './bindings';
import { runScheduledTicks } from './cloudflare-scheduled';

/*
 * The Worker entry of the Cloudflare build (`main` in `wrangler.jsonc`). `fetch` is TanStack
 * Start's own handler, unchanged; `scheduled` runs the ticks of the cron trigger.
 */

/** The part of the Workers `ExecutionContext` the entry uses. */
interface ExecutionContext {
	readonly waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * Runs the ticks of a cron event (see `runScheduledTicks`) with a database of its own: a
 * scheduled event has no request, so the request scoped database of `getAppContext` does not
 * exist here. The pool is ended after the last tick. Failures are logged by name and rethrown
 * without their message, so the cron event shows as failed without exposing details.
 *
 * @param bindings The Worker's bindings.
 */
async function handleCronEvent(bindings: Bindings): Promise<void> {
	try {
		const env = parseEnv(variablesOf(bindings));
		const storage = await openStorage(env, bindings);
		const { db, end } = await openDb(env.databaseUrl, 'neon', {
			devNeonWsProxy: env.devNeonWsProxy,
		});
		try {
			await runScheduledTicks(async () => runTick({ db, env, steps: tickSteps, storage }));
		} finally {
			await end();
		}
	} catch (error) {
		// oxlint-disable-next-line no-console -- name or code only, the message may carry details
		console.error('scheduled tick failed', errorLabel(error));
		// oxlint-disable-next-line preserve-caught-error -- the cause may carry connection details, it is logged by name above
		throw new Error('scheduled tick failed');
	}
}

export default {
	async fetch(request: Request): Promise<Response> {
		return handler.fetch(request);
	},
	scheduled(_controller: unknown, bindings: Bindings, ctx: ExecutionContext): void {
		ctx.waitUntil(handleCronEvent(bindings));
	},
};
