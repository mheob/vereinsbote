import type { Db } from '@/server/db/client';
import { levelAtLeast } from '@/server/permissions/levels';
import { canAccessArea, ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { customFieldKey } from './fields';
import type { ContactKind, FieldKey } from './fields';
import { getContactSettings, getFieldAreas, kindAreaId, listCustomFields } from './settings';

/** What one user may do with contacts (design 10). */
interface ContactAccess {
	/** `read` in any area: the list and the base fields of all contacts. */
	readonly canList: boolean;
	/** `edit` in the members or partners area: suppressions, opt-outs, import, partner upkeep. */
	readonly canManage: Readonly<Record<ContactKind, boolean>>;
	/** Per kind the protected fields the user sees and every base custom field. */
	readonly visible: Readonly<Record<ContactKind, ReadonlySet<FieldKey>>>;
}

const NO_FIELDS: ReadonlySet<FieldKey> = new Set();

/** No list, no management, no field: for users without any area. */
const NO_ACCESS: ContactAccess = {
	canList: false,
	canManage: { member: false, partner: false },
	visible: { member: NO_FIELDS, partner: NO_FIELDS },
};

/**
 * The fields of a kind one user sees: a protected field with `read` in one of its areas, a
 * custom field with the protection `base` always.
 *
 * @param db The database.
 * @param principal Who asks.
 * @param kind The kind.
 * @returns The visible field keys.
 */
async function visibleFields(
	db: Db,
	principal: Principal,
	kind: ContactKind,
): Promise<ReadonlySet<FieldKey>> {
	const fieldAreas = await getFieldAreas(db, kind);
	const custom = await listCustomFields(db, kind);
	const visible = new Set<FieldKey>();
	for (const [key, areaIds] of fieldAreas) {
		if (areaIds.some((areaId) => canAccessArea(principal, areaId, 'read'))) visible.add(key);
	}
	for (const field of custom) {
		if (field.protection === 'base') visible.add(customFieldKey(field.id));
	}
	return visible;
}

/**
 * Loads what a user may do with contacts. The admin role gives nothing: only area levels count.
 *
 * @param db The database.
 * @param principal Who asks.
 * @returns The access.
 */
async function loadContactAccess(db: Db, principal: Principal): Promise<ContactAccess> {
	const canList = [...principal.areas.values()].some((level) => levelAtLeast(level, 'read'));
	if (!canList) return NO_ACCESS;
	const settings = await getContactSettings(db);
	const canManage = (kind: ContactKind): boolean => {
		const areaId = kindAreaId(settings, kind);
		return areaId !== null && canAccessArea(principal, areaId, 'edit');
	};
	const member = await visibleFields(db, principal, 'member');
	const partner = await visibleFields(db, principal, 'partner');
	return {
		canList,
		canManage: { member: canManage('member'), partner: canManage('partner') },
		visible: { member, partner },
	};
}

/**
 * Requires access to the contact list.
 *
 * @param access The user's access.
 * @throws {ForbiddenError} Without `read` in any area.
 */
function assertCanList(access: ContactAccess): void {
	if (!access.canList) throw new ForbiddenError('Forbidden');
}

/**
 * Requires the right to manage contacts of a kind.
 *
 * @param access The user's access.
 * @param kind The kind.
 * @throws {ForbiddenError} Without `edit` in the area of the kind.
 */
function assertCanManage(access: ContactAccess, kind: ContactKind): void {
	if (!access.canManage[kind]) throw new ForbiddenError('Forbidden');
}

export { assertCanList, assertCanManage, loadContactAccess };
export type { ContactAccess };
