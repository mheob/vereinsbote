import { loadContactAccess } from '@/server/contacts/access';
import { getContactSettings } from '@/server/contacts/settings';
import { getImportFreshness } from '@/server/contacts/stale-import';
import type { Db } from '@/server/db/client';
import { hasSystemSender } from '@/server/mail/system-mailer';
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
	/** Admins only: no sender sends the system mails, so no login link or invitation goes out. */
	readonly noSystemSender: boolean;
}

/**
 * Whether to tell the user that no system sender is chosen: admins only (Design 14).
 *
 * @param db The database.
 * @param principal Who looks at the page.
 * @returns True for an admin while no sender sends the system mails.
 */
async function lacksSystemSender(db: Db, principal: Principal): Promise<boolean> {
	return principal.isAdmin && !(await hasSystemSender(db));
}

/**
 * The data notice of the page frame: before the first member import, or when the member data is
 * old; only for readers of the members area and for admins.
 *
 * @param db The database.
 * @param principal Who looks at the page.
 * @param at Whether the user may import members, and the instant to judge the import at.
 * @param at.canImport Whether the user may import members.
 * @param at.now The instant.
 * @returns The notice, or null.
 */
async function frameNotice(
	db: Db,
	principal: Principal,
	{ canImport, now }: Readonly<{ canImport: boolean; now: Date }>,
): Promise<FrameNotice | null> {
	const { membersAreaId } = await getContactSettings(db);
	const readsMembers = membersAreaId !== null && canAccessArea(principal, membersAreaId, 'read');
	if (!readsMembers && !principal.isAdmin) return null;
	const freshness = await getImportFreshness(db, now);
	if (freshness.lastImportAt === null) return { canImport, kind: 'firstImport' };
	if (!freshness.stale) return null;
	return {
		canImport,
		kind: 'stale',
		lastImportAt: freshness.lastImportAt.toISOString(),
		weeks: freshness.weeks,
	};
}

/**
 * Loads the navigation, the data notice and, for admins, the notice about the system sender of
 * the page frame.
 *
 * @param db The database.
 * @param principal Who looks at the page.
 * @param now The instant to judge the age of the import at.
 * @returns The links to show and the notices, if any.
 */
async function loadFrameInfo(db: Db, principal: Principal, now: Date): Promise<FrameInfo> {
	// Not inside a transaction: the access loads its parts in parallel.
	const [access, noSystemSender] = await Promise.all([
		loadContactAccess(db, principal),
		lacksSystemSender(db, principal),
	]);
	const nav = {
		admin: principal.isAdmin,
		contacts: access.canList,
		importMembers: access.canManage.member,
		importPartners: access.canManage.partner,
		templates: principal.areas.size > 0,
	};
	const notice = await frameNotice(db, principal, { canImport: access.canManage.member, now });
	return { nav, noSystemSender, notice };
}

export { loadFrameInfo };
export type { FrameInfo, FrameNotice };
