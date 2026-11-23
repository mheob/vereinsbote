import { describe, expect, it } from 'vite-plus/test';

import { createTestDb } from './db/test-db';
import { getState, setState } from './system-state';

describe('system state', () => {
	it('applies migrations to an empty database', async () => {
		const db = await createTestDb();
		await expect(getState(db, 'last_tick')).resolves.toBeNull();
	});

	it('setState upserts', async () => {
		const db = await createTestDb();
		await setState(db, 'last_tick', { n: 1 });
		await setState(db, 'last_tick', { n: 2 });
		await expect(getState(db, 'last_tick')).resolves.toStrictEqual({ n: 2 });
	});
});
