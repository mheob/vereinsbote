import { describe, expect, it } from 'vite-plus/test';

import type { Db } from '@/server/db/client';
import { areaMemberships, areas, user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { insertUser } from '@/server/users/repo';

import { assertAdmin, assertArea, canAccessArea, ForbiddenError, loadPrincipal } from './principal';
import type { Principal } from './principal';

async function insertArea(db: Db, name: string): Promise<string> {
	const [area] = await db.insert(areas).values({ name }).returning({ id: areas.id });
	if (!area) {
		throw new Error('area not inserted');
	}
	return area.id;
}

async function principalOf(db: Db, userId: string): Promise<Principal> {
	const p = await loadPrincipal(db, userId);
	if (!p) {
		throw new Error('no principal');
	}
	return p;
}

describe(loadPrincipal, () => {
	it('gives an admin without membership no area access', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, {
			email: 'a@v.de',
			isAdmin: true,
			name: 'A',
			status: 'active',
		});
		const areaId = await insertArea(db, 'Finanzen');
		const p = await principalOf(db, id);
		expect(p.isAdmin).toBe(true);
		expect(canAccessArea(p, areaId, 'read')).toBe(false);
		expect(() => {
			assertArea(p, areaId, 'read');
		}).toThrow(ForbiddenError);
	});

	it('lets a member with edit read and edit but not send', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'm@v.de', name: 'M', status: 'active' });
		const areaId = await insertArea(db, 'Finanzen');
		await db.insert(areaMemberships).values({ areaId, level: 'edit', userId: id });
		const p = await principalOf(db, id);
		expect(p.areas.get(areaId)).toBe('edit');
		expect([
			canAccessArea(p, areaId, 'read'),
			canAccessArea(p, areaId, 'edit'),
			canAccessArea(p, areaId, 'send'),
		]).toStrictEqual([true, true, false]);
	});

	it('gives a member no access to other areas', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'm@v.de', name: 'M', status: 'active' });
		const areaId = await insertArea(db, 'Finanzen');
		const otherId = await insertArea(db, 'Vorstand');
		await db.insert(areaMemberships).values({ areaId, level: 'send', userId: id });
		const p = await principalOf(db, id);
		expect(canAccessArea(p, otherId, 'read')).toBe(false);
	});

	it('returns no principal for a disabled user', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'd@v.de', name: 'D', status: 'disabled' });
		await expect(loadPrincipal(db, id)).resolves.toBeNull();
	});

	it('returns no principal for an unknown user', async () => {
		const db = await createTestDb();
		await expect(loadPrincipal(db, 'does-not-exist')).resolves.toBeNull();
	});

	it('returns a principal for an invited user', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'i@v.de', name: 'I', status: 'invited' });
		await expect(loadPrincipal(db, id)).resolves.toMatchObject({ isAdmin: false, userId: id });
	});
});

describe(assertArea, () => {
	it('passes with a sufficient level and throws with an insufficient one', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'm@v.de', name: 'M', status: 'active' });
		const areaId = await insertArea(db, 'Finanzen');
		await db.insert(areaMemberships).values({ areaId, level: 'edit', userId: id });
		const p = await principalOf(db, id);
		expect(() => {
			assertArea(p, areaId, 'edit');
		}).not.toThrow();
		expect(() => {
			assertArea(p, areaId, 'send');
		}).toThrow(ForbiddenError);
	});
});

describe(assertAdmin, () => {
	it('passes for an admin', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, {
			email: 'a@v.de',
			isAdmin: true,
			name: 'A',
			status: 'active',
		});
		const p = await principalOf(db, id);
		expect(() => {
			assertAdmin(p);
		}).not.toThrow();
	});

	it('throws for a non-admin', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'm@v.de', name: 'M', status: 'active' });
		const p = await principalOf(db, id);
		expect(() => {
			assertAdmin(p);
		}).toThrow(ForbiddenError);
	});
});

describe('areas schema', () => {
	it('rejects a name that differs only in case', async () => {
		const db = await createTestDb();
		await insertArea(db, 'Finanzen');
		await expect(insertArea(db, 'finanzen')).rejects.toThrow('Failed query');
	});

	it('removes memberships with the user', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'm@v.de', name: 'M', status: 'active' });
		const areaId = await insertArea(db, 'Finanzen');
		await db.insert(areaMemberships).values({ areaId, level: 'read', userId: id });
		await db.delete(user);
		await expect(db.select().from(areaMemberships)).resolves.toHaveLength(0);
	});
});
