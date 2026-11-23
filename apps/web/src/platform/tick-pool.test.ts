import { describe, expect, it, vi } from 'vite-plus/test';

import type { Db, DbHandle } from '@/server/db/client';

import { createTickPool } from './tick-pool';

function fakeHandle(): DbHandle {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pool never touches the client itself
	return { db: {} as Db, end: vi.fn<() => Promise<void>>().mockResolvedValue() };
}

describe(createTickPool, () => {
	it('opens the database once and reuses it', async () => {
		const handle = fakeHandle();
		const openPool = vi.fn<() => Promise<DbHandle>>().mockResolvedValue(handle);
		const pool = createTickPool(openPool);
		await expect(pool.open()).resolves.toBe(handle);
		await expect(pool.open()).resolves.toBe(handle);
		expect(openPool).toHaveBeenCalledOnce();
	});

	it('tries again after a failed open', async () => {
		const handle = fakeHandle();
		const openPool = vi
			.fn<() => Promise<DbHandle>>()
			.mockRejectedValueOnce(new Error('down'))
			.mockResolvedValue(handle);
		const pool = createTickPool(openPool);
		await expect(pool.open()).rejects.toThrow('down');
		await expect(pool.open()).resolves.toBe(handle);
		expect(openPool).toHaveBeenCalledTimes(2);
	});

	it('ends an opened database on close and opens a new one afterwards', async () => {
		const first = fakeHandle();
		const openPool = vi
			.fn<() => Promise<DbHandle>>()
			.mockResolvedValueOnce(first)
			.mockResolvedValue(fakeHandle());
		const pool = createTickPool(openPool);
		await pool.open();
		await pool.close();
		expect(first.end).toHaveBeenCalledOnce();
		await expect(pool.open()).resolves.not.toBe(first);
	});

	it('closes without opening when no tick ran', async () => {
		const openPool = vi.fn<() => Promise<DbHandle>>();
		await createTickPool(openPool).close();
		expect(openPool).not.toHaveBeenCalled();
	});
});
