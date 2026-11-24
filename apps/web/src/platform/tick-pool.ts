import type { DbHandle } from '@/server/db/client';
import { errorLabel } from '@/server/error-label';

/** The database pool of the Node ticks: opened on the first tick, ended on shutdown. */
interface TickPool {
	open: () => Promise<DbHandle>;
	close: () => Promise<void>;
}

/**
 * Creates the pool of the Node ticks. A failed attempt to open it is not kept, so the next tick
 * tries again. Closing ends an opened pool; a tick still running then fails on its next query,
 * and its lock expires on its own.
 *
 * @param openPool Opens the database.
 * @returns The pool.
 */
function createTickPool(openPool: () => Promise<DbHandle>): TickPool {
	let handle: Promise<DbHandle> | null = null;
	return {
		async close() {
			const opened = handle;
			handle = null;
			if (opened === null) return;
			try {
				const { end } = await opened;
				await end();
			} catch (error) {
				// oxlint-disable-next-line no-console -- name or code only, the server shuts down anyway
				console.error('tick pool close failed', errorLabel(error));
			}
		},
		async open() {
			handle ??= openPool();
			try {
				return await handle;
			} catch (error) {
				handle = null;
				throw error;
			}
		},
	};
}

export { createTickPool };
export type { TickPool };
