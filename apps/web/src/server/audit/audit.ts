import type { Db } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';

type AuditAction =
	| 'area.created'
	| 'area.renamed'
	| 'contact.opt_out_removed'
	| 'contact.opted_out'
	| 'contact.suppressed'
	| 'contact.unsuppressed'
	| 'contacts.settings_changed'
	| 'media.deleted'
	| 'media.uploaded'
	| 'import.members'
	| 'import.partners'
	| 'import.stale_warning'
	| 'partner.created'
	| 'partner.deleted'
	| 'partner.updated'
	| 'setup.completed'
	| 'user.admin_changed'
	| 'user.area_level_changed'
	| 'user.disabled'
	| 'user.enabled'
	| 'user.invited';

interface AuditEntry {
	/** The acting user, or null for the system. */
	readonly actorUserId: string | null;
	readonly action: AuditAction;
	readonly target?: string;
	/** Never put secrets or e-mail addresses here. */
	readonly details?: Readonly<Record<string, unknown>>;
	readonly at?: Date;
}

/**
 * Appends an entry to the audit log.
 *
 * @param db The database.
 * @param entry What happened; `at` defaults to now.
 */
async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
	await db.insert(auditLog).values({
		action: entry.action,
		actorUserId: entry.actorUserId,
		at: entry.at,
		details: entry.details,
		target: entry.target,
	});
}

export { writeAudit };
export type { AuditAction, AuditEntry };
