import { describe, expect, it } from 'vite-plus/test';

import type { Db } from './client';
import { contacts } from './schema';
import { createTestDb } from './test-db';

describe(createTestDb, () => {
	// The second test checks what the end of the first did, so they run in this order.
	let first: Db | undefined;

	it('opens a migrated, empty database', async () => {
		first = await createTestDb();
		await expect(first.select({ id: contacts.id }).from(contacts)).resolves.toStrictEqual([]);
	});

	it('closes the database when its test ends', async () => {
		expect(first).toBeDefined();
		await expect(first?.select({ id: contacts.id }).from(contacts)).rejects.toThrow();
	});
});
