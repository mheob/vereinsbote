import type { TickReport } from './tick';

/**
 * At most this many ticks follow the first one of a trigger (cron, interval or request). A step
 * that keeps reporting more work then waits for the next trigger instead of keeping the
 * database awake and the invocations billed without end.
 */
const MAX_CHAINED_TICKS = 8;

interface TickChainOptions {
	/** Runs one tick. */
	run: () => Promise<TickReport>;
	/** Epoch milliseconds after which no further tick starts. Default: no limit. */
	startDeadline?: number;
	now?: () => number;
}

/**
 * Whether a report asks for another tick right away.
 *
 * @param report The report of the last tick.
 * @returns True when the tick completed and left work.
 */
function wantsMore(report: TickReport): boolean {
	return report.status === 'completed' && report.moreWork;
}

/**
 * Runs a tick and then, one after another, further ticks while the last one left work: at most
 * `MAX_CHAINED_TICKS` more, and none after `startDeadline`. The ticks never overlap.
 *
 * @param options The tick runner and the latest start time.
 * @returns How many ticks ran.
 */
async function runTickChain(options: Readonly<TickChainOptions>): Promise<number> {
	const { now = Date.now, run, startDeadline = Number.POSITIVE_INFINITY } = options;
	let ticks = 1;
	let report = await run();
	while (wantsMore(report) && ticks <= MAX_CHAINED_TICKS && now() <= startDeadline) {
		ticks += 1;
		// oxlint-disable-next-line no-await-in-loop -- each tick waits for the previous one by design
		report = await run();
	}
	return ticks;
}

export { MAX_CHAINED_TICKS, runTickChain, wantsMore };
export type { TickChainOptions };
