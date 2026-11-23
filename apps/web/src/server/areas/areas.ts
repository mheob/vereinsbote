/* oxlint-disable max-classes-per-file -- the two area errors belong to the module that throws them */
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { areaMemberships, areas } from '@/server/db/schema';
import type { AccessLevel } from '@/server/permissions/levels';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { isValidAreaName } from './form';

/** Another area has this name, ignoring case. */
class AreaExistsError extends Error {
	public constructor() {
		super('An area with this name already exists.');
		this.name = 'AreaExistsError';
	}
}

/** The name is empty or longer than `MAX_AREA_NAME_LENGTH` after trimming. */
class AreaNameInvalidError extends Error {
	public constructor() {
		super('An area name has 1 to 60 characters after trimming.');
		this.name = 'AreaNameInvalidError';
	}
}

/** An area as one user sees it. */
interface AreaListing {
	id: string;
	name: string;
	/** The caller's own level in the area; null without access. */
	level: AccessLevel | null;
}

/**
 * Trims a name and checks it.
 *
 * @param name The name as typed.
 * @returns The trimmed name.
 * @throws {AreaNameInvalidError} When the trimmed name is empty or too long.
 */
function checkedName(name: string): string {
	if (!isValidAreaName(name)) throw new AreaNameInvalidError();
	return name.trim();
}

/**
 * Runs a write that may hit the unique index on `lower(areas.name)`.
 *
 * @param write The write.
 * @returns The result of the write.
 * @throws {AreaExistsError} When another area has the name, ignoring case.
 */
async function withUniqueName<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (isUniqueViolation(error)) throw new AreaExistsError();
		throw error;
	}
}

/**
 * Creates an area. The name is stored trimmed; the unique index on `lower(name)` refuses a name
 * another area has in any case, even when two admins create it at the same time.
 *
 * @param db The database.
 * @param actor Who creates the area; must be an admin.
 * @param name The name as typed.
 * @returns The id of the new area.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {AreaNameInvalidError} When the name is empty or too long.
 * @throws {AreaExistsError} When another area has the name.
 */
async function createArea(db: Db, actor: Principal, name: string): Promise<{ areaId: string }> {
	assertAdmin(actor);
	const trimmed = checkedName(name);
	return withUniqueName(async () =>
		db.transaction(async (tx) => {
			const [created] = await tx
				.insert(areas)
				.values({ name: trimmed })
				.returning({ id: areas.id });
			if (created === undefined) throw new Error('Inserting the area returned no row.');
			await writeAudit(tx, {
				action: 'area.created',
				actorUserId: actor.userId,
				details: { name: trimmed },
				target: `area:${created.id}`,
			});
			return { areaId: created.id };
		}),
	);
}

/**
 * Renames an area. The name is stored trimmed; changing only its case is allowed.
 *
 * @param db The database.
 * @param actor Who renames the area; must be an admin.
 * @param areaId The id of the area.
 * @param name The new name as typed.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {AreaNameInvalidError} When the name is empty or too long.
 * @throws {AreaExistsError} When another area has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function renameArea(db: Db, actor: Principal, areaId: string, name: string): Promise<void> {
	assertAdmin(actor);
	const trimmed = checkedName(name);
	await withUniqueName(async () =>
		db.transaction(async (tx) => {
			const [current] = await tx
				.select({ name: areas.name })
				.from(areas)
				.where(eq(areas.id, areaId))
				.for('update');
			if (current === undefined) throw new Error('The area does not exist.');
			if (current.name === trimmed) return;
			await tx.update(areas).set({ name: trimmed }).where(eq(areas.id, areaId));
			await writeAudit(tx, {
				action: 'area.renamed',
				actorUserId: actor.userId,
				details: { from: current.name, to: trimmed },
				target: `area:${areaId}`,
			});
		}),
	);
}

/**
 * Lists the areas a user sees, by name: admins see every area, everybody else only the areas
 * they have a level in. The level is always the caller's own; the admin role gives none.
 *
 * @param db The database.
 * @param actor Who asks.
 * @returns The areas with the caller's level.
 */
async function listAreas(db: Db, actor: Principal): Promise<AreaListing[]> {
	return db
		.select({ id: areas.id, level: areaMemberships.level, name: areas.name })
		.from(areas)
		.leftJoin(
			areaMemberships,
			and(eq(areaMemberships.areaId, areas.id), eq(areaMemberships.userId, actor.userId)),
		)
		.where(actor.isAdmin ? undefined : isNotNull(areaMemberships.level))
		.orderBy(sql`lower(${areas.name})`, areas.name);
}

export { AreaExistsError, AreaNameInvalidError, createArea, listAreas, renameArea };
export type { AreaListing };
