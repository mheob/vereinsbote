import { and, eq, sql } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { areas, contactOptOuts, contacts, contactSuppressions } from '@/server/db/schema';
import type { Principal } from '@/server/permissions/principal';

import { assertCanList, assertCanManage, loadContactAccess } from './access';
import type { ContactAccess } from './access';
import { ContactNotFoundError, UnknownAreaError } from './errors';
import type { ContactKind } from './fields';
import { bumpStockVersion, lockImportState } from './import-state';

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
 * Loads the contact, checks that the user may manage its kind and locks the import state of the
 * kind. The key is read after the lock: an import or a partner edit that changes keys holds the
 * lock until it ends, so the key is the current one and nothing waits in the other order.
 *
 * @param tx The transaction.
 * @param access The user's access, loaded before the transaction.
 * @param contactId The contact.
 * @returns The contact and its key.
 * @throws {ForbiddenError} Without `edit` in the area of the kind.
 * @throws {ContactNotFoundError} For an unknown contact.
 */
async function loadManagedContact(
	tx: Db,
	access: ContactAccess,
	contactId: string,
): Promise<{ contact: ContactIdentity & { id: string }; key: string }> {
	const [found] = await tx
		.select({ kind: contacts.kind })
		.from(contacts)
		.where(eq(contacts.id, contactId));
	if (found === undefined) throw new ContactNotFoundError();
	assertCanManage(access, found.kind);
	await lockImportState(tx, found.kind);
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
	// Deleted while this waited for the lock.
	if (row === undefined) throw new ContactNotFoundError();
	const key = contactKey(row);
	if (key === null) throw new Error('The contact has no key.');
	return { contact: row, key };
}

/**
 * Loads what a user may do with contacts and requires the contact list. Runs before the
 * transaction: the access check runs queries in parallel, which the single connection of a
 * transaction would have to queue (node-postgres deprecates that).
 *
 * @param db The database.
 * @param principal Who acts.
 * @returns The access.
 * @throws {ForbiddenError} Without `read` in any area.
 */
async function listingAccess(db: Db, principal: Principal): Promise<ContactAccess> {
	const access = await loadContactAccess(db, principal);
	assertCanList(access);
	return access;
}

/**
 * Suppresses a contact ("no more mail") or lifts the suppression. A repeated call changes
 * nothing: no log entry, no new stock version. Waits for a running import or partner edit of the
 * contact's kind.
 *
 * @param db The database.
 * @param principal Who acts; needs `edit` in the area of the contact's kind.
 * @param contactId The contact.
 * @param suppressed Whether the contact is suppressed afterwards.
 * @throws {ForbiddenError} Without the right.
 * @throws {ContactNotFoundError} For an unknown contact.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function setSuppression(
	db: Db,
	principal: Principal,
	contactId: string,
	suppressed: boolean,
): Promise<void> {
	const access = await listingAccess(db, principal);
	await db.transaction(async (tx) => {
		const { contact, key } = await loadManagedContact(tx, access, contactId);
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
 * nothing: no log entry, no new stock version. Waits for a running import or partner edit of the
 * contact's kind.
 *
 * @param db The database.
 * @param principal Who acts; needs `edit` in the area of the contact's kind.
 * @param input The contact, the area and whether the contact objects afterwards.
 * @throws {ForbiddenError} Without the right.
 * @throws {ContactNotFoundError} For an unknown contact.
 * @throws {UnknownAreaError} For an unknown area.
 */
async function setOptOut(
	db: Db,
	principal: Principal,
	input: Readonly<{ contactId: string; areaId: string; optedOut: boolean }>,
): Promise<void> {
	const access = await listingAccess(db, principal);
	await db.transaction(async (tx) => {
		const { contact, key } = await loadManagedContact(tx, access, input.contactId);
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
 * Copies the suppression and the opt-outs of a key to another key, e.g. when one of two partners
 * with the same address gets a new one: the other partner keeps them under the old key. Entries
 * the target key already has stay; nothing is duplicated.
 *
 * @param tx The transaction.
 * @param kind The kind.
 * @param from The old key.
 * @param to The new key.
 */
// oxlint-disable-next-line max-params -- the same parameters as rekeyContactKey
async function copyContactKey(tx: Db, kind: ContactKind, from: string, to: string): Promise<void> {
	if (from === to) return;
	await tx.execute(sql`
		insert into contact_suppressions (kind, contact_key, created_at, created_by_user_id)
		select kind, ${to}, created_at, created_by_user_id from contact_suppressions
		where kind = ${kind} and contact_key = ${from}
		on conflict do nothing`);
	// Skip what the target has already: same scope, area and occasion.
	await tx.execute(sql`
		insert into contact_opt_outs
			(kind, contact_key, scope, area_id, occasion_id, created_at, created_by_user_id)
		select old.kind, ${to}, old.scope, old.area_id, old.occasion_id, old.created_at,
			old.created_by_user_id
		from contact_opt_outs old
		where old.kind = ${kind} and old.contact_key = ${from}
		and not exists (
			select 1 from contact_opt_outs kept
			where kept.kind = old.kind and kept.contact_key = ${to} and kept.scope = old.scope
			and kept.area_id is not distinct from old.area_id
			and kept.occasion_id is not distinct from old.occasion_id)
		on conflict do nothing`);
}

/**
 * Moves the suppression and the opt-outs of a contact to a new key, e.g. when a partner gets a
 * customer number. Entries the target key already has stay; nothing is duplicated. The caller
 * bumps the stock version and writes the audit entry.
 *
 * @param tx The transaction.
 * @param kind The kind.
 * @param from The old key.
 * @param to The new key.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function rekeyContactKey(tx: Db, kind: ContactKind, from: string, to: string): Promise<void> {
	if (from === to) return;
	await copyContactKey(tx, kind, from, to);
	await tx
		.delete(contactSuppressions)
		.where(and(eq(contactSuppressions.kind, kind), eq(contactSuppressions.contactKey, from)));
	await tx
		.delete(contactOptOuts)
		.where(and(eq(contactOptOuts.kind, kind), eq(contactOptOuts.contactKey, from)));
}

export { auditTarget, contactKey, copyContactKey, rekeyContactKey, setOptOut, setSuppression };
