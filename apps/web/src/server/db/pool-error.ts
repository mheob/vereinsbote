import { errorLabel } from '@/server/error-label';

/** What a pool of both drivers (pg-pool, Neon's) offers for its `error` events and its end. */
interface ErrorEmittingPool {
	readonly on: (event: 'error', listener: (error: unknown) => void) => unknown;
	readonly end: () => Promise<void>;
}

/**
 * The label of a pool error: the code or name of an Error, the type of an Event (Neon forwards
 * its WebSocket's `error` Event, which is no Error and carries no message).
 *
 * @param error What the pool emitted.
 * @returns The label, never a message.
 */
function poolErrorLabel(error: unknown): string {
	if (typeof Event !== 'undefined' && error instanceof Event) return `Event ${error.type}`;
	return errorLabel(error);
}

/**
 * Attaches the pool `error` listener of both drivers and returns the function that ends the pool.
 * An idle client that loses its connection emits `error`; unhandled, that kills the process. The
 * pool drops the client and the next query opens a new one, so the listener only logs, by code or
 * name, never the message: it may carry connection details.
 *
 * Once `end` has started, errors are ignored: closing the sockets makes them fail (pg-pool keeps
 * its listener on idle clients after `end`, Neon forwards the WebSocket's `error` Event), which is
 * the pool going away, not the database. Errors of an open pool stay visible.
 *
 * @param pool The pool.
 * @returns Ends the pool.
 */
function logPoolErrorsUntilEnd(pool: ErrorEmittingPool): () => Promise<void> {
	let ending = false;
	pool.on('error', (error) => {
		if (ending) return;
		// oxlint-disable-next-line no-console -- the only trace of a flapping database
		console.error('db pool error', poolErrorLabel(error));
	});
	return async () => {
		ending = true;
		await pool.end();
	};
}

export { logPoolErrorsUntilEnd };
export type { ErrorEmittingPool };
