import { and, eq, sql } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { areas, contactOptOuts, contacts, contactSuppressions } from '@/server/db/schema';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { assertCanManage, loadContactAccess } from './access';
import type { ContactKind } from './fields';
import { bumpStockVersion } from './import-state';

/** The area of an opt-out does not exist. The message names no contact data. */
class UnknownAreaError extends Error {
	public constructor() {
		super('Unknown area.');
		this.name = 'UnknownAreaError';
	}
}

/** The columns that identify a contact. */
interface ContactIdentity {
	readonly kind: ContactKind;
	readonly memberNumber: string | null;
	readonly customerNumber: string | null;
	readonly email: string | null;
}

/**
 * The key that joins a contact to its suppression and opt-outs; the same as the generated column
 * `contacts.contact_key`.
 *
 * @param contact The identifying columns.
 * @returns `nr:<number>` or `email:<address>`; null without any of them.
 */
function contactKey(contact: Readonly<ContactIdentity>): string | null {
	if (contact.kind === 'member') {
		return contact.memberNumber === null ? null : `nr:${contact.memberNumber}`;
	}
	if (contact.customerNumber !== null) return `nr:${contact.customerNumber}`;
	return contact.email === null ? null : `email:${contact.email}`;
}

/**
 * How the audit log names a contact: by number, never by name or address.
 *
 * @param contact The contact.
 * @returns `member:<number>`, `partner:<number>` or `contact:<id>`.
 */
function auditTarget(
	contact: Readonly<{
		id: string;
		kind: ContactKind;
		memberNumber: string | null;
		customerNumber: string | null;
	}>,
): string {
	const number = contact.kind === 'member' ? contact.memberNumber : contact.customerNumber;
	return number === null ? `contact:${contact.id}` : `${contact.kind}:${number}`;
}

/**
 * Loads the contact and checks that the user may manage its kind.
 *
 * @param tx The transaction.
 * @param principal Who acts.
 * @param contactId The contact.
 * @returns The contact and its key.
 * @throws {ForbiddenError} Without `edit` in the area of the kind.
 * @throws {Error} For an unknown contact.
 */
async function loadManagedContact(
	tx: Db,
	principal: Principal,
	contactId: string,
): Promise<{ contact: ContactIdentity & { id: string }; key: string }> {
	const access = await loadContactAccess(tx, principal);
	if (!access.canList) throw new ForbiddenError('Forbidden');
	const [row] = await tx
		.select({
			customerNumber: contacts.customerNumber,
			email: contacts.email,
			id: contacts.id,
			kind: contacts.kind,
			memberNumber: contacts.memberNumber,
		})
		.from(contacts)
		.where(eq(contacts.id, contactId));
	if (row === undefined) throw new Error('Unknown contact.');
	assertCanManage(access, row.kind);
	const key = contactKey(row);
	if (key === null) throw new Error('The contact has no key.');
	return { contact: row, key };
}

/**
 * Suppresses a contact ("no more mail") or lifts the suppression. A repeated call changes
 * nothing: no log entry, no new stock version.
 *
 * @param db The database.
 * @param principal Who acts; needs `edit` in the area of the contact's kind.
 * @param contactId The contact.
 * @param suppressed Whether the contact is suppressed afterwards.
 * @throws {ForbiddenError} Without the right.
 * @throws {Error} For an unknown contact.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function setSuppression(
	db: Db,
	principal: Principal,
	contactId: string,
	suppressed: boolean,
): Promise<void> {
	await db.transaction(async (tx) => {
		const { contact, key } = await loadManagedContact(tx, principal, contactId);
		const changed = suppressed
			? await tx
					.insert(contactSuppressions)
					.values({ contactKey: key, createdByUserId: principal.userId, kind: contact.kind })
					.onConflictDoNothing()
					.returning({ key: contactSuppressions.contactKey })
			: await tx
					.delete(contactSuppressions)
					.where(
						and(
							eq(contactSuppressions.kind, contact.kind),
							eq(contactSuppressions.contactKey, key),
						),
					)
					.returning({ key: contactSuppressions.contactKey });
		if (changed.length === 0) return;
		await bumpStockVersion(tx, contact.kind);
		await writeAudit(tx, {
			action: suppressed ? 'contact.suppressed' : 'contact.unsuppressed',
			actorUserId: principal.userId,
			target: auditTarget(contact),
		});
	});
}

/**
 * Records or removes a contact's objection to the mail of one area. A repeated call changes
 * nothing: no log entry, no new stock version.
 *
 * @param db The database.
 * @param principal Who acts; needs `edit` in the area of the contact's kind.
 * @param input The contact, the area and whether the contact objects afterwards.
 * @throws {ForbiddenError} Without the right.
 * @throws {Error} For an unknown contact.
 * @throws {UnknownAreaError} For an unknown area.
 */
async function setOptOut(
	db: Db,
	principal: Principal,
	input: Readonly<{ contactId: string; areaId: string; optedOut: boolean }>,
): Promise<void> {
	await db.transaction(async (tx) => {
		const { contact, key } = await loadManagedContact(tx, principal, input.contactId);
		const [area] = await tx.select({ id: areas.id }).from(areas).where(eq(areas.id, input.areaId));
		if (area === undefined) throw new UnknownAreaError();
		const changed = input.optedOut
			? await tx
					.insert(contactOptOuts)
					.values({
						areaId: input.areaId,
						contactKey: key,
						createdByUserId: principal.userId,
						kind: contact.kind,
						scope: 'area',
					})
					.onConflictDoNothing()
					.returning({ id: contactOptOuts.id })
			: await tx
					.delete(contactOptOuts)
					.where(
						and(
							eq(contactOptOuts.kind, contact.kind),
							eq(contactOptOuts.contactKey, key),
							eq(contactOptOuts.scope, 'area'),
							eq(contactOptOuts.areaId, input.areaId),
						),
					)
					.returning({ id: contactOptOuts.id });
		if (changed.length === 0) return;
		await bumpStockVersion(tx, contact.kind);
		await writeAudit(tx, {
			action: input.optedOut ? 'contact.opted_out' : 'contact.opt_out_removed',
			actorUserId: principal.userId,
			details: { areaId: input.areaId },
			target: auditTarget(contact),
		});
	});
}

/**
 * Moves the suppression and the opt-outs of a contact to a new key, e.g. when a partner gets a
 * customer number. Entries the target key already has stay; nothing is duplicated.
 *
 * @param tx The transaction.
 * @param kind The kind.
 * @param from The old key.
 * @param to The new key.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function rekeyContactKey(tx: Db, kind: ContactKind, from: string, to: string): Promise<void> {
	if (from === to) return;
	await tx.execute(sql`
		insert into contact_suppressions (kind, contact_key, created_at, created_by_user_id)
		select kind, ${to}, created_at, created_by_user_id from contact_suppressions
		where kind = ${kind} and contact_key = ${from}
		on conflict do nothing`);
	await tx
		.delete(contactSuppressions)
		.where(and(eq(contactSuppressions.kind, kind), eq(contactSuppressions.contactKey, from)));
	// Drop what the target has already (same scope, area and occasion), then move the rest.
	await tx.execute(sql`
		delete from contact_opt_outs old
		where old.kind = ${kind} and old.contact_key = ${from}
		and exists (
			select 1 from contact_opt_outs kept
			where kept.kind = old.kind and kept.contact_key = ${to} and kept.scope = old.scope
			and kept.area_id is not distinct from old.area_id
			and kept.occasion_id is not distinct from old.occasion_id)`);
	await tx
		.update(contactOptOuts)
		.set({ contactKey: to })
		.where(and(eq(contactOptOuts.kind, kind), eq(contactOptOuts.contactKey, from)));
}

export { auditTarget, contactKey, rekeyContactKey, setOptOut, setSuppression, UnknownAreaError };
