import { desc } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import type { Db } from '@/server/db/client';
import { areaMemberships, areas, auditLog } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError, loadPrincipal } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { insertUser } from '@/server/users/repo';

import { AreaExistsError, AreaNameInvalidError, createArea, listAreas, renameArea } from './areas';

async function principalOf(db: Db, id: string): Promise<Principal> {
	const found = await loadPrincipal(db, id);
	if (found === null) throw new Error('no principal');
	return found;
}

/**
 * Creates an active admin.
 *
 * @param db The database.
 * @returns The admin's principal.
 */
async function admin(db: Db): Promise<Principal> {
	const { id } = await insertUser(db, {
		email: 'admin@v.de',
		isAdmin: true,
		name: 'Alex',
		status: 'active',
	});
	return principalOf(db, id);
}

async function kim(db: Db): Promise<string> {
	const { id } = await insertUser(db, { email: 'kim@v.de', name: 'Kim', status: 'active' });
	return id;
}

async function areaNames(db: Db): Promise<string[]> {
	const rows = await db.select({ name: areas.name }).from(areas).orderBy(areas.name);
	return rows.map((row) => row.name);
}

async function lastAudit(db: Db): Promise<typeof auditLog.$inferSelect | undefined> {
	const [entry] = await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
	return entry;
}

describe(createArea, () => {
	it('rejects duplicate names case-insensitively', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		await createArea(db, a, 'Veranstaltungen');
		await expect(createArea(db, a, ' veranstaltungen ')).rejects.toBeInstanceOf(AreaExistsError);
		await expect(areaNames(db)).resolves.toStrictEqual(['Veranstaltungen']);
	});

	it('stores the trimmed name and writes an audit entry', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { areaId } = await createArea(db, a, '  Vorstand ');
		await expect(areaNames(db)).resolves.toStrictEqual(['Vorstand']);
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'area.created',
			actorUserId: a.userId,
			details: { name: 'Vorstand' },
			target: `area:${areaId}`,
		});
	});

	it('accepts 60 characters and rejects empty or longer names', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		await expect(createArea(db, a, '   ')).rejects.toBeInstanceOf(AreaNameInvalidError);
		await expect(createArea(db, a, 'x'.repeat(61))).rejects.toBeInstanceOf(AreaNameInvalidError);
		await createArea(db, a, ` ${'x'.repeat(60)} `);
		await expect(areaNames(db)).resolves.toStrictEqual(['x'.repeat(60)]);
	});

	it('only admins can create areas', async () => {
		const db = await createTestDb();
		const p = await principalOf(db, await kim(db));
		await expect(createArea(db, p, 'Vorstand')).rejects.toBeInstanceOf(ForbiddenError);
		await expect(areaNames(db)).resolves.toStrictEqual([]);
	});
});

describe(renameArea, () => {
	it('renames an area and writes an audit entry with the old and new name', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { areaId } = await createArea(db, a, 'Vorstand');
		await renameArea(db, a, areaId, ' Vorstandsarbeit ');
		await expect(areaNames(db)).resolves.toStrictEqual(['Vorstandsarbeit']);
		await expect(lastAudit(db)).resolves.toMatchObject({
			action: 'area.renamed',
			details: { from: 'Vorstand', to: 'Vorstandsarbeit' },
			target: `area:${areaId}`,
		});
	});

	it('rejects the name of another area in any case', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		await createArea(db, a, 'Finanzen');
		const { areaId } = await createArea(db, a, 'Vorstand');
		await expect(renameArea(db, a, areaId, 'FINANZEN')).rejects.toBeInstanceOf(AreaExistsError);
		await expect(areaNames(db)).resolves.toStrictEqual(['Finanzen', 'Vorstand']);
	});

	it('allows changing only the case of its own name', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { areaId } = await createArea(db, a, 'vorstand');
		await renameArea(db, a, areaId, 'Vorstand');
		await expect(areaNames(db)).resolves.toStrictEqual(['Vorstand']);
	});

	it('rejects an invalid name and non-admins', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { areaId } = await createArea(db, a, 'Vorstand');
		const p = await principalOf(db, await kim(db));
		await expect(renameArea(db, a, areaId, ' ')).rejects.toBeInstanceOf(AreaNameInvalidError);
		await expect(renameArea(db, p, areaId, 'Neu')).rejects.toBeInstanceOf(ForbiddenError);
		await expect(areaNames(db)).resolves.toStrictEqual(['Vorstand']);
	});
});

describe(listAreas, () => {
	it('non-admins list only their own areas with their level', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const id = await kim(db);
		const { areaId } = await createArea(db, a, 'Finanzen');
		await createArea(db, a, 'Mitglieder');
		await db.insert(areaMemberships).values({ areaId, level: 'read', userId: id });
		await expect(listAreas(db, await principalOf(db, id))).resolves.toStrictEqual([
			{ id: areaId, level: 'read', name: 'Finanzen' },
		]);
	});

	it('admins list all areas with their own level', async () => {
		const db = await createTestDb();
		const a = await admin(db);
		const { areaId: members } = await createArea(db, a, 'Mitglieder');
		const { areaId: finance } = await createArea(db, a, 'finanzen');
		await db.insert(areaMemberships).values({ areaId: members, level: 'edit', userId: a.userId });
		await expect(listAreas(db, a)).resolves.toStrictEqual([
			{ id: finance, level: null, name: 'finanzen' },
			{ id: members, level: 'edit', name: 'Mitglieder' },
		]);
	});
});
