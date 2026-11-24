import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import type { Db } from '@/server/db/client';
import { areaMemberships, areas, auditLog, systemState, user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { canAccessArea, loadPrincipal } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { getState } from '@/server/system-state';
import { findUserByEmail } from '@/server/users/repo';

import {
	completeSetup,
	isSetupDone,
	SetupAlreadyDoneError,
	SetupDisabledError,
	SetupTokenInvalidError,
} from './setup';

const TOKEN = 't'.repeat(24);

const input = {
	adminEmail: ' Admin@Verein.de',
	adminName: 'Alex',
	expectedToken: TOKEN,
	token: TOKEN,
};

const NOTHING = { areas: 0, audit: 0, memberships: 0, state: 0, users: 0 };

/**
 * Counts the rows the setup writes, table by table.
 *
 * @param db The database.
 * @returns The number of rows per table.
 */
async function rowCounts(db: Db): Promise<typeof NOTHING> {
	const [users, areaRows, memberships, audit, state] = await Promise.all([
		db.select().from(user),
		db.select().from(areas),
		db.select().from(areaMemberships),
		db.select().from(auditLog),
		db.select().from(systemState),
	]);
	return {
		areas: areaRows.length,
		audit: audit.length,
		memberships: memberships.length,
		state: state.length,
		users: users.length,
	};
}

/**
 * The value under `setup_completed_at`.
 *
 * @param db The database.
 * @returns The marker.
 */
async function setupMarker(db: Db): Promise<{ adminUserId: string; at: string }> {
	const marker = await getState<{ adminUserId: string; at: string }>(db, 'setup_completed_at');
	if (marker === null) throw new Error('The setup marker is missing.');
	return marker;
}

async function principalOf(db: Db, userId: string): Promise<Principal> {
	const p = await loadPrincipal(db, userId);
	if (p === null) throw new Error('The user has no principal.');
	return p;
}

async function areaIdOf(db: Db, name: string): Promise<string> {
	const [area] = await db.select().from(areas).where(eq(areas.name, name));
	if (area === undefined) throw new Error(`The area ${name} is missing.`);
	return area.id;
}

/**
 * Awaits a promise that must reject.
 *
 * @param promise The promise.
 * @returns The rejection reason.
 */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('The promise resolved.');
}

describe(completeSetup, () => {
	it('refuses when no token is configured', async () => {
		const db = await createTestDb();
		await expect(completeSetup(db, { ...input, expectedToken: null })).rejects.toBeInstanceOf(
			SetupDisabledError,
		);
		await expect(rowCounts(db)).resolves.toStrictEqual(NOTHING);
	});

	it('refuses a wrong token and creates nothing', async () => {
		const db = await createTestDb();
		await expect(completeSetup(db, { ...input, token: 'x'.repeat(24) })).rejects.toBeInstanceOf(
			SetupTokenInvalidError,
		);
		await expect(isSetupDone(db)).resolves.toBe(false);
		await expect(db.select().from(user)).resolves.toHaveLength(0);
		await expect(rowCounts(db)).resolves.toStrictEqual(NOTHING);
	});

	it('refuses tokens that only start or end like the right one', async () => {
		const db = await createTestDb();
		for (const token of ['', TOKEN.slice(0, -1), `${TOKEN}t`, ` ${TOKEN}`]) {
			// oxlint-disable-next-line no-await-in-loop -- one attempt after the other on the single test connection
			await expect(completeSetup(db, { ...input, token })).rejects.toBeInstanceOf(
				SetupTokenInvalidError,
			);
		}
		await expect(rowCounts(db)).resolves.toStrictEqual(NOTHING);
	});

	it('names neither token in its errors', async () => {
		const db = await createTestDb();
		const wrong = 'w'.repeat(24);
		const error = await failureOf(completeSetup(db, { ...input, token: wrong }));
		expect(error).toBeInstanceOf(SetupTokenInvalidError);
		const text = JSON.stringify(error, Object.getOwnPropertyNames(error));
		expect(text).not.toContain(wrong);
		expect(text).not.toContain(TOKEN);
	});

	it('creates an active admin with the normalized address and the trimmed name', async () => {
		const db = await createTestDb();
		const { adminUserId } = await completeSetup(db, { ...input, adminName: ' Alex ' });
		await expect(findUserByEmail(db, 'admin@verein.de')).resolves.toStrictEqual({
			id: adminUserId,
			isAdmin: true,
			locale: 'de',
			status: 'active',
		});
		await expect(
			db.select({ email: user.email, name: user.name }).from(user),
		).resolves.toStrictEqual([{ email: 'admin@verein.de', name: 'Alex' }]);
	});

	it('creates admin, default areas and edit access to Mitglieder', async () => {
		const db = await createTestDb();
		const { adminUserId } = await completeSetup(db, input);
		const p = await principalOf(db, adminUserId);
		const all = await db.select().from(areas);
		expect(all.map((a) => a.name).toSorted()).toStrictEqual(['Finanzen', 'Mitglieder']);
		expect(p.isAdmin).toBe(true);
		expect(canAccessArea(p, await areaIdOf(db, 'Mitglieder'), 'edit')).toBe(true);
		expect(canAccessArea(p, await areaIdOf(db, 'Mitglieder'), 'send')).toBe(false);
		expect(canAccessArea(p, await areaIdOf(db, 'Finanzen'), 'read')).toBe(false);
	});

	it('gives the admin exactly one membership: edit in Mitglieder', async () => {
		const db = await createTestDb();
		const { adminUserId } = await completeSetup(db, input);
		await expect(db.select().from(areaMemberships)).resolves.toStrictEqual([
			{ areaId: await areaIdOf(db, 'Mitglieder'), level: 'edit', userId: adminUserId },
		]);
	});

	it('writes one audit entry that names the admin by id only', async () => {
		const db = await createTestDb();
		const { adminUserId } = await completeSetup(db, input);
		const audit = await db.select().from(auditLog);
		expect(audit.map((r) => r.action)).toStrictEqual(['setup.completed']);
		expect(audit[0]).toMatchObject({ actorUserId: adminUserId, target: `user:${adminUserId}` });
		expect(JSON.stringify(audit)).not.toContain('admin@verein.de');
	});

	it('records the admin in the setup marker', async () => {
		const db = await createTestDb();
		const { adminUserId } = await completeSetup(db, input);
		const marker = await setupMarker(db);
		expect(Object.keys(marker).toSorted()).toStrictEqual(['adminUserId', 'at']);
		expect(marker.adminUserId).toBe(adminUserId);
		expect(new Date(marker.at).toISOString()).toBe(marker.at);
	});

	it('stores the language of the setup request as the admin language', async () => {
		const db = await createTestDb();
		await completeSetup(db, { ...input, adminLocale: 'en' });
		await expect(findUserByEmail(db, 'admin@verein.de')).resolves.toMatchObject({ locale: 'en' });
	});

	it('refuses a second setup', async () => {
		const db = await createTestDb();
		await completeSetup(db, input);
		await expect(
			completeSetup(db, { ...input, adminEmail: 'other@verein.de', adminName: 'Kim' }),
		).rejects.toBeInstanceOf(SetupAlreadyDoneError);
		await expect(rowCounts(db)).resolves.toStrictEqual({
			areas: 2,
			audit: 1,
			memberships: 1,
			state: 1,
			users: 1,
		});
	});

	it('creates exactly one admin when submitted twice in parallel', async () => {
		const db = await createTestDb();
		const results = await Promise.allSettled([completeSetup(db, input), completeSetup(db, input)]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.filter((r) => r.status === 'rejected');
		expect(rejected).toHaveLength(1);
		expect(rejected[0]?.reason).toBeInstanceOf(SetupAlreadyDoneError);
		await expect(db.select().from(user)).resolves.toHaveLength(1);
		await expect(rowCounts(db)).resolves.toStrictEqual({
			areas: 2,
			audit: 1,
			memberships: 1,
			state: 1,
			users: 1,
		});
	});

	it('keeps nothing when a later step fails', async () => {
		const db = await createTestDb();
		// An area that already exists makes the area step fail after the admin was inserted.
		await db.insert(areas).values({ name: 'mitglieder' });
		const error = await failureOf(completeSetup(db, input));
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(SetupAlreadyDoneError);
		await expect(isSetupDone(db)).resolves.toBe(false);
		await expect(rowCounts(db)).resolves.toStrictEqual({ ...NOTHING, areas: 1 });
	});
});

describe(isSetupDone, () => {
	it('is false before and true after the setup', async () => {
		const db = await createTestDb();
		await expect(isSetupDone(db)).resolves.toBe(false);
		await completeSetup(db, input);
		await expect(isSetupDone(db)).resolves.toBe(true);
	});
});
