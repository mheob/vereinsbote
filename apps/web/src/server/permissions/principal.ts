import { eq } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { areaMemberships, user } from '@/server/db/schema';

import { levelAtLeast } from './levels';
import type { AccessLevel } from './levels';

interface Principal {
	readonly userId: string;
	readonly isAdmin: boolean;
	/** The access level per area id; areas without an entry are not accessible. */
	readonly areas: ReadonlyMap<string, AccessLevel>;
}

class ForbiddenError extends Error {
	public override name = 'ForbiddenError';
}

/**
 * Loads who a user is and what they may do. The admin role gives no area access; that comes
 * from memberships only.
 *
 * @param db The database.
 * @param userId The id of the user.
 * @returns The principal, or null for an unknown or disabled user.
 */
async function loadPrincipal(db: Db, userId: string): Promise<Principal | null> {
	const [row] = await db
		.select({ isAdmin: user.isAdmin, status: user.status })
		.from(user)
		.where(eq(user.id, userId));
	if (!row || row.status === 'disabled') {
		return null;
	}
	const memberships = await db
		.select({ areaId: areaMemberships.areaId, level: areaMemberships.level })
		.from(areaMemberships)
		.where(eq(areaMemberships.userId, userId));
	return {
		areas: new Map(memberships.map((m) => [m.areaId, m.level])),
		isAdmin: row.isAdmin,
		userId,
	};
}

/**
 * Tells whether the principal has at least the given level in an area.
 *
 * @param p The principal.
 * @param areaId The id of the area.
 * @param need The required level.
 * @returns True when allowed.
 */
function canAccessArea(p: Principal, areaId: string, need: AccessLevel): boolean {
	return levelAtLeast(p.areas.get(areaId) ?? null, need);
}

/**
 * Requires at least the given level in an area.
 *
 * @param p The principal.
 * @param areaId The id of the area.
 * @param need The required level.
 * @throws {ForbiddenError} When the principal lacks the level.
 */
function assertArea(p: Principal, areaId: string, need: AccessLevel): void {
	if (!canAccessArea(p, areaId, need)) {
		throw new ForbiddenError('Forbidden');
	}
}

/**
 * Requires the admin role.
 *
 * @param p The principal.
 * @throws {ForbiddenError} When the principal is no admin.
 */
function assertAdmin(p: Principal): void {
	if (!p.isAdmin) {
		throw new ForbiddenError('Forbidden');
	}
}

export { assertAdmin, assertArea, canAccessArea, ForbiddenError, loadPrincipal };
export type { Principal };
