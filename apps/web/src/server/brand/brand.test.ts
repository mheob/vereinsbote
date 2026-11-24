import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import type { Brand, BrandLogo } from '@/mail/brand/brand-schema';
import { setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { auditLog, media } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { newMediaId } from '@/server/media/ids';
import { ForbiddenError } from '@/server/permissions/principal';

import { BrandChangedError, getBrand, saveBrand, UnknownLogoError } from './brand';

const BRANDED: Brand = { ...DEFAULT_BRAND, name: 'Musterverein' };

async function insertImage(
	db: Db,
	options: Readonly<{ areaId?: string }> = {},
): Promise<BrandLogo> {
	const id = newMediaId();
	await db.insert(media).values({
		areaId: options.areaId ?? null,
		bytes: 100,
		height: 60,
		id,
		name: 'logo.png',
		purpose: options.areaId === undefined ? 'brand' : 'library',
		type: 'png',
		width: 200,
	});
	return { alt: 'Logo', height: 60, mediaId: id, type: 'png', width: 200 };
}

describe(getBrand, () => {
	it('returns the default brand until an admin saves one', async () => {
		const db = await createTestDb();
		await expect(getBrand(db)).resolves.toStrictEqual({
			brand: DEFAULT_BRAND,
			configured: false,
			version: 0,
		});
	});

	it('returns what was saved', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await saveBrand(db, admin, { brand: BRANDED, version: 0 });
		await expect(getBrand(db)).resolves.toStrictEqual({
			brand: BRANDED,
			configured: true,
			version: 1,
		});
	});

	it('falls back to the default brand when the stored settings no longer parse', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await saveBrand(db, admin, { brand: BRANDED, version: 0 });
		const { brandSettings } = await import('@/server/db/schema');
		await db.update(brandSettings).set({ settings: { name: 1 } });
		await expect(getBrand(db)).resolves.toMatchObject({
			brand: DEFAULT_BRAND,
			configured: true,
			version: 1,
		});
	});
});

describe(saveBrand, () => {
	it('saves for admins only', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const sender = await userWith(db, { [membersAreaId]: 'send' });
		await expect(saveBrand(db, sender, { brand: BRANDED, version: 0 })).rejects.toThrow(
			ForbiddenError,
		);
		await expect(getBrand(db)).resolves.toMatchObject({ configured: false });
		await expect(saveBrand(db, admin, { brand: BRANDED, version: 0 })).resolves.toStrictEqual({
			version: 1,
		});
	});

	it('logs a save without content', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await saveBrand(db, admin, { brand: BRANDED, version: 0 });
		const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'brand.changed'));
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ actorUserId: admin.userId, target: 'brand' });
		expect(JSON.stringify(entries[0])).not.toContain('Musterverein');
	});

	it('refuses a brand that does not pass the schema', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const invalid = { ...BRANDED, colors: { ...BRANDED.colors, primary: 'red' } };
		await expect(saveBrand(db, admin, { brand: invalid, version: 0 })).rejects.toThrow();
		await expect(getBrand(db)).resolves.toMatchObject({ configured: false });
	});

	it('refuses a stale version', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await saveBrand(db, admin, { brand: BRANDED, version: 0 });
		await saveBrand(db, admin, { brand: { ...BRANDED, name: 'Erster' }, version: 1 });
		await expect(
			saveBrand(db, admin, { brand: { ...BRANDED, name: 'Zweiter' }, version: 1 }),
		).rejects.toThrow(BrandChangedError);
		await expect(getBrand(db)).resolves.toMatchObject({ brand: { name: 'Erster' } });
	});

	it('refuses a first save when a brand exists already', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await saveBrand(db, admin, { brand: BRANDED, version: 0 });
		await expect(saveBrand(db, admin, { brand: BRANDED, version: 0 })).rejects.toThrow(
			BrandChangedError,
		);
	});

	it('refuses a version that is ahead of the stored one', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await expect(saveBrand(db, admin, { brand: BRANDED, version: 3 })).rejects.toThrow(
			BrandChangedError,
		);
	});

	it('accepts only brand images as logos', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const library = await insertImage(db, { areaId: membersAreaId });
		await expect(
			saveBrand(db, admin, { brand: { ...BRANDED, headerLogo: library }, version: 0 }),
		).rejects.toThrow(UnknownLogoError);
		const missing: BrandLogo = { ...library, mediaId: newMediaId() };
		await expect(
			saveBrand(db, admin, { brand: { ...BRANDED, footerLogo: missing }, version: 0 }),
		).rejects.toThrow(UnknownLogoError);
		await expect(getBrand(db)).resolves.toMatchObject({ configured: false });

		const logo = await insertImage(db);
		await saveBrand(db, admin, { brand: { ...BRANDED, headerLogo: logo }, version: 0 });
		await expect(getBrand(db)).resolves.toMatchObject({ brand: { headerLogo: logo } });
	});

	it('keeps the row of a replaced logo', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const first = await insertImage(db);
		const second = await insertImage(db);
		await saveBrand(db, admin, { brand: { ...BRANDED, headerLogo: first }, version: 0 });
		await saveBrand(db, admin, { brand: { ...BRANDED, headerLogo: second }, version: 1 });
		const rows = await db.select({ id: media.id }).from(media);
		expect(rows.map((row) => row.id).toSorted()).toStrictEqual(
			[first.mediaId, second.mediaId].toSorted(),
		);
	});

	it('does not trust the logo size in the input: it is taken from the stored image', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const logo = await insertImage(db);
		await saveBrand(db, admin, {
			brand: { ...BRANDED, headerLogo: { ...logo, height: 999, width: 999 } },
			version: 0,
		});
		await expect(getBrand(db)).resolves.toMatchObject({
			brand: { headerLogo: { height: 60, width: 200 } },
		});
	});
});
