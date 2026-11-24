import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { logPoolErrorsUntilEnd } from './pool-error';

/** A pool like pg-pool and Neon's: emits `error`, and its sockets may still fail during `end`. */
// oxlint-disable-next-line unicorn/prefer-event-target -- pg-pool and Neon's Pool are Node EventEmitters
class FakePool extends EventEmitter {
	public ended = 0;

	/** What the pool emits while it ends, like the WebSocket `error` Event Neon forwards. */
	public duringEnd: unknown = null;

	// oxlint-disable-next-line typescript/require-await -- the fake ends at once
	public async end(): Promise<void> {
		this.ended += 1;
		if (this.duringEnd !== null) this.emit('error', this.duringEnd);
	}
}

describe(logPoolErrorsUntilEnd, () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('logs an error of the open pool by its code', () => {
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		const pool = new FakePool();
		logPoolErrorsUntilEnd(pool);
		const error = Object.assign(new Error('read ECONNRESET at db.internal'), {
			code: 'ECONNRESET',
		});
		pool.emit('error', error);
		expect(logged).toHaveBeenCalledExactlyOnceWith('db pool error', 'ECONNRESET');
	});

	it('logs a WebSocket error Event of the open pool by its type', () => {
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		const pool = new FakePool();
		logPoolErrorsUntilEnd(pool);
		pool.emit('error', new Event('error'));
		expect(logged).toHaveBeenCalledExactlyOnceWith('db pool error', 'Event error');
	});

	it('ends the pool once per call of its end', async () => {
		const pool = new FakePool();
		const end = logPoolErrorsUntilEnd(pool);
		await end();
		expect(pool.ended).toBe(1);
	});

	it('ignores errors once the pool is ending', async () => {
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		const pool = new FakePool();
		pool.duringEnd = new Event('error');
		const end = logPoolErrorsUntilEnd(pool);
		await end();
		pool.emit('error', new Error('late'));
		expect(logged).not.toHaveBeenCalled();
	});
});
