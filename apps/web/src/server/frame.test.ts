import { describe, expect, it } from 'vite-plus/test';

import { recordConfirmedImport } from '@/server/contacts/import-state';
import { setUpClub, userWith } from '@/server/contacts/testing';
import { createTestDb } from '@/server/db/test-db';

import { loadFrameInfo } from './frame';

const NOW = new Date('2026-11-24T10:00:00Z');
const DAY_MS = 86_400_000;

describe(loadFrameInfo, () => {
	it('links contacts for any area, imports for the kind area and admin pages for admins', async () => {
		const db = await createTestDb();
		const { admin, partnersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [partnersAreaId]: 'edit' });
		await expect(loadFrameInfo(db, editor, NOW)).resolves.toMatchObject({
			nav: { admin: false, contacts: true, importMembers: false, importPartners: true },
		});
		const outsider = await userWith(db, {});
		await expect(loadFrameInfo(db, outsider, NOW)).resolves.toStrictEqual({
			nav: { admin: false, contacts: false, importMembers: false, importPartners: false },
			notice: null,
		});
		// The setup gave the admin `edit` in the members area.
		await expect(loadFrameInfo(db, admin, NOW)).resolves.toMatchObject({
			nav: { admin: true, contacts: true, importMembers: true, importPartners: false },
		});
	});

	it('shows the first-import notice to members-area readers and admins only', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		await expect(loadFrameInfo(db, reader, NOW)).resolves.toMatchObject({
			notice: { canImport: false, kind: 'firstImport' },
		});
		const adminWithoutArea = await userWith(db, {}, { isAdmin: true });
		await expect(loadFrameInfo(db, adminWithoutArea, NOW)).resolves.toMatchObject({
			notice: { canImport: false, kind: 'firstImport' },
		});
		const finance = await userWith(db, { [partnersAreaId]: 'edit' });
		const financeInfo = await loadFrameInfo(db, finance, NOW);
		expect(financeInfo.notice).toBeNull();
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		await expect(loadFrameInfo(db, editor, NOW)).resolves.toMatchObject({
			notice: { canImport: true, kind: 'firstImport' },
		});
	});

	it('shows the stale notice after the deadline', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const at = new Date(NOW.getTime() - 63 * DAY_MS);
		await recordConfirmedImport(db, 'member', { at, mapping: null });
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		await expect(loadFrameInfo(db, reader, NOW)).resolves.toStrictEqual({
			nav: { admin: false, contacts: true, importMembers: false, importPartners: false },
			notice: { canImport: false, kind: 'stale', lastImportAt: at.toISOString(), weeks: 8 },
		});
		const fresh = await loadFrameInfo(db, reader, new Date(at.getTime() + DAY_MS));
		expect(fresh.notice).toBeNull();
	});
});
