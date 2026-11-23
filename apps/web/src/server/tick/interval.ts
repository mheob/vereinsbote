import { errorLabel } from '@/server/error-label';

interface TickIntervalDeps {
	intervalMs: number;
	/** Runs one tick. */
	run: () => Promise<unknown>;
}

/**
 * Runs a tick every `intervalMs`, first after one interval. While a run is still in flight, the
 * next one is skipped rather than started alongside. A failed run is only logged, by error name.
 * The timer does not keep the process alive on its own.
 *
 * @param deps The interval and the tick runner.
 * @returns A function that stops the interval.
 */
function startTickInterval(deps: Readonly<TickIntervalDeps>): () => void {
	let inFlight = false;
	const tick = async (): Promise<void> => {
		if (inFlight) return;
		inFlight = true;
		try {
			await deps.run();
		} catch (error) {
			// oxlint-disable-next-line no-console -- name or code only, the message may carry details
			console.error('tick failed', errorLabel(error));
		} finally {
			inFlight = false;
		}
	};
	const timer = setInterval(() => {
		// oxlint-disable-next-line no-void -- `tick` never rejects, it logs its own failures
		void tick();
	}, deps.intervalMs);
	timer.unref();
	return () => {
		clearInterval(timer);
	};
}

export { startTickInterval };
