import { runTickChain } from '@/server/tick/chain';
import { TICK_BUDGET_MS } from '@/server/tick/tick';
import type { TickReport } from '@/server/tick/tick';

/**
 * 15 minutes: Cloudflare ends a Cron Trigger invocation after 15 minutes of wall time (Workers limits,
 * "Duration"). CPU time is limited separately, to 30 seconds per invocation for triggers more
 * frequent than hourly; a tick mostly waits for the database, which does not count.
 */
const CRON_WALL_TIME_MS = 900_000;
/** Room for a tick that overruns its budget and for ending the database pool. */
const SAFETY_MARGIN_MS = 60_000;
/** A tick starts only this long after the trigger at the latest: 10 minutes. */
const LAST_START_MS = CRON_WALL_TIME_MS - TICK_BUDGET_MS - SAFETY_MARGIN_MS;

/**
 * Runs the ticks of one cron event: a tick, then further ticks right away while work is left,
 * as long as a whole tick budget still fits into the wall time of the invocation. There is no
 * HTTP self-chaining on Cloudflare: `waitUntil` work ends 30 seconds after a response.
 *
 * @param run Runs one tick.
 * @param now The clock, in epoch milliseconds.
 * @returns How many ticks ran.
 */
async function runScheduledTicks(
	run: () => Promise<TickReport>,
	now: () => number = Date.now,
): Promise<number> {
	return runTickChain({ now, run, startDeadline: now() + LAST_START_MS });
}

export { LAST_START_MS, runScheduledTicks };
