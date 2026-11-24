import { describe, expect, it } from 'vite-plus/test';

import { createTestDb } from '@/server/db/test-db';

import {
	bumpStockVersion,
	getImportState,
	lockImportState,
	recordConfirmedImport,
} from './import-state';

describe('import state', () => {
	it('counts the stock version per kind and records a confirmed import', async () => {
		const db = await createTestDb();
		await expect(getImportState(db, 'member')).resolves.toStrictEqual({
			kind: 'member',
			lastConfirmedAt: null,
			mapping: null,
			stockVersion: 0,
		});

		await bumpStockVersion(db, 'member');
		await bumpStockVersion(db, 'member');
		await expect(getImportState(db, 'member')).resolves.toMatchObject({ stockVersion: 2 });
		await expect(getImportState(db, 'partner')).resolves.toMatchObject({ stockVersion: 0 });

		const at = new Date('2026-11-24T10:00:00Z');
		await recordConfirmedImport(db, 'member', { at, mapping: { a: 1 } });
		await expect(getImportState(db, 'member')).resolves.toStrictEqual({
			kind: 'member',
			lastConfirmedAt: at,
			mapping: { a: 1 },
			stockVersion: 3,
		});
		await expect(getImportState(db, 'partner')).resolves.toMatchObject({ stockVersion: 0 });
	});

	it('creates the row on locking and keeps it', async () => {
		const db = await createTestDb();
		await db.transaction(async (tx) => {
			await expect(lockImportState(tx, 'partner')).resolves.toStrictEqual({
				kind: 'partner',
				lastConfirmedAt: null,
				mapping: null,
				stockVersion: 0,
			});
			await bumpStockVersion(tx, 'partner');
			await expect(lockImportState(tx, 'partner')).resolves.toMatchObject({ stockVersion: 1 });
		});
		await expect(getImportState(db, 'partner')).resolves.toMatchObject({ stockVersion: 1 });
	});
});
