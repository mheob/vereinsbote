import type { Db } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';

type AuditAction =
	| 'area.created'
	| 'area.renamed'
	| 'brand.changed'
	| 'connection.created'
	| 'connection.deleted'
	| 'connection.updated'
	| 'contact.opt_out_removed'
	| 'contact.opted_out'
	| 'contact.suppressed'
	| 'contact.unsuppressed'
	| 'contacts.settings_changed'
	| 'layout.created'
	| 'layout.deleted'
	| 'layout.updated'
	| 'media.copied'
	| 'media.deleted'
	| 'media.uploaded'
	| 'import.members'
	| 'import.partners'
	| 'import.stale_warning'
	| 'occasion.archived'
	| 'occasion.created'
	| 'occasion.deleted'
	| 'occasion.updated'
	| 'partner.created'
	| 'partner.deleted'
	| 'partner.updated'
	| 'sender.created'
	| 'sender.deleted'
	| 'sender.self_tested'
	| 'sender.system_set'
	| 'sender.updated'
	| 'sending.digest_sent'
	| 'sending.disturbance_warned'
	| 'sending.secret_warned'
	| 'setup.completed'
	| 'template.created'
	| 'template.deleted'
	| 'template.duplicated'
	| 'template.updated'
	| 'user.admin_changed'
	| 'user.area_level_changed'
	| 'user.disabled'
	| 'user.enabled'
	| 'user.invitation_resent'
	| 'user.invited'
	| 'wave.created';

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
