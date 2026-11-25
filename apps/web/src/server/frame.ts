import { loadContactAccess } from '@/server/contacts/access';
import { getContactSettings } from '@/server/contacts/settings';
import { getImportFreshness } from '@/server/contacts/stale-import';
import type { Db } from '@/server/db/client';
import { canAccessArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

type FrameNotice =
	| Readonly<{ kind: 'stale'; lastImportAt: string; weeks: number; canImport: boolean }>
	| Readonly<{ kind: 'firstImport'; canImport: boolean }>;

/** What the page frame needs besides the language and the session. */
interface FrameInfo {
	readonly nav: Readonly<{
		admin: boolean;
		contacts: boolean;
		importMembers: boolean;
		importPartners: boolean;
		/** Templates and image library: `read` in any area (the admin role alone gives none). */
		templates: boolean;
	}>;
	/** Only for readers of the members area and for admins. */
	readonly notice: FrameNotice | null;
}

/**
 * Loads the navigation and the data notice of the page frame.
 *
 * @param db The database.
 * @param principal Who looks at the page.
 * @param now The instant to judge the age of the import at.
 * @returns The links to show and the notice, if any.
 */
async function loadFrameInfo(db: Db, principal: Principal, now: Date): Promise<FrameInfo> {
	// Not inside a transaction: the access loads its parts in parallel.
	const access = await loadContactAccess(db, principal);
	const nav = {
		admin: principal.isAdmin,
		contacts: access.canList,
		importMembers: access.canManage.member,
		importPartners: access.canManage.partner,
		templates: principal.areas.size > 0,
	};
	const { membersAreaId } = await getContactSettings(db);
	const readsMembers = membersAreaId !== null && canAccessArea(principal, membersAreaId, 'read');
	if (!readsMembers && !principal.isAdmin) return { nav, notice: null };
	const canImport = access.canManage.member;
	const freshness = await getImportFreshness(db, now);
	if (freshness.lastImportAt === null) return { nav, notice: { canImport, kind: 'firstImport' } };
	if (!freshness.stale) return { nav, notice: null };
	return {
		nav,
		notice: {
			canImport,
			kind: 'stale',
			lastImportAt: freshness.lastImportAt.toISOString(),
			weeks: freshness.weeks,
		},
	};
}

export { loadFrameInfo };
export type { FrameInfo, FrameNotice };
