/*
 * The mark „E-Mail ungültig“ and the complaints (Design 13). A hard bounce, reported by Graph's
 * inbox (`graph-step.ts`) or Resend's webhook (`resend-webhook-handler.ts`), sets its outbox entry
 * to `bounced` and marks every contact of the entry with the address the mail went to (from
 * `wave_contacts`); a soft one only leaves its code on the entry. A complaint (Resend „marked as
 * spam“) opts every contact of the entry out of the wave's area, without a user. A mark hangs on
 * kind, contact key and address, so it no longer applies once the contact has another address.
 * Who has `edit` in the area of the wave the mark came from (without an entry: in the area of the
 * contact's kind) may clear it.
 */
import { and, eq, ne } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import { normalizeEmail } from '@/server/auth/email';
import { assertCanList, loadContactAccess } from '@/server/contacts/access';
import { ContactNotFoundError } from '@/server/contacts/errors';
import type { ContactKind } from '@/server/contacts/fields';
import { bumpStockVersion, lockImportState } from '@/server/contacts/import-state';
import { getContactSettings, kindAreaId } from '@/server/contacts/settings';
import { auditTarget, auditTargetsOfKeys, optOutByKey } from '@/server/contacts/suppressions';
import type { Db } from '@/server/db/client';
import { contactBounces, contacts, outboxEntries, waveContacts, waves } from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';
import { canAccessArea, ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

/** Where a bounce was reported. */
type BounceSource = (typeof contactBounces.$inferInsert)['source'];

/** The outbox entry of a report: by its Message-ID (Graph) or the id Resend gave it. */
type BouncedEntry = Readonly<{ messageId: string }> | Readonly<{ providerId: string }>;

/** A bounce report. */
interface BounceInput {
	readonly entry: BouncedEntry;
	/** A permanent failure (the address does not exist); a soft one is only logged. */
	readonly hard: boolean;
	readonly source: BounceSource;
	/** When the provider reported it; the time of the mark. */
	readonly at: Date;
}

/** The mark of a contact's current address. */
interface BounceMark {
	readonly at: Date;
	readonly source: BounceSource;
	/** Where `edit` clears it: the wave's area, else the area of the contact's kind; null when none. */
	readonly areaId: string | null;
}

/** A contact's kind, key and current address. */
type MarkedContact = Readonly<Pick<ContactRecord, 'contactKey' | 'email' | 'kind'>>;

/** A contact of an entry by kind and key. */
type KeyedContact = Readonly<{ kind: ContactKind; key: string }>;

/** The code a hard bounce leaves on its entry. */
const HARD_BOUNCE_CODE = 'bounce.hard';
/** The code a soft bounce leaves on its entry; the entry stays as it is. */
const SOFT_BOUNCE_CODE = 'bounce.soft';

/** The order the import-state locks are taken in, as everywhere else. */
const KIND_ORDER: readonly ContactKind[] = ['member', 'partner'];

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

/**
 * The mark of a contact row's current address, for joins on `contacts`: the rule of
 * `isEmailInvalid` (addresses are stored normalized).
 */
const bounceOfContact = and(
	eq(contactBounces.kind, contacts.kind),
	eq(contactBounces.contactKey, contacts.contactKey),
	eq(contactBounces.email, contacts.email),
);

/**
 * The condition of a contact's mark at an address.
 *
 * @param contact The kind and key.
 * @param email The normalized address.
 * @returns The condition.
 */
function markOf(
	contact: Readonly<Pick<ContactRecord, 'contactKey' | 'kind'>>,
	email: string,
): SQL | undefined {
	return and(
		eq(contactBounces.kind, contact.kind),
		eq(contactBounces.contactKey, contact.contactKey),
		eq(contactBounces.email, email),
	);
}

/**
 * Whether the contact's current address is marked invalid. The mark hangs on kind, contact key
 * and address: an address that changed since the bounce is not marked. The recipients of a wave
 * and the contact list apply the same rule in their queries (`bounceOfContact`).
 *
 * @param db The database.
 * @param contact The contact's kind, key and current address.
 * @returns True when the address bounced hard; false without an address.
 */
async function isEmailInvalid(db: Db, contact: MarkedContact): Promise<boolean> {
	if (contact.email === null) return false;
	const [row] = await db
		.select({ email: contactBounces.email })
		.from(contactBounces)
		.where(markOf(contact, normalizeEmail(contact.email)))
		.limit(1);
	return row !== undefined;
}

/**
 * Reads the mark of a contact's current address with the area its clearing needs.
 *
 * @param db The database or a transaction.
 * @param contact The contact's kind, key and current address.
 * @param lock Whether to lock the mark until the transaction ends.
 * @returns The mark, or null when the current address has none.
 */
async function readMark(db: Db, contact: MarkedContact, lock: boolean): Promise<BounceMark | null> {
	if (contact.email === null) return null;
	const query = db
		.select({
			at: contactBounces.createdAt,
			source: contactBounces.source,
			waveAreaId: waves.areaId,
		})
		.from(contactBounces)
		.leftJoin(outboxEntries, eq(outboxEntries.id, contactBounces.entryId))
		.leftJoin(waves, eq(waves.id, outboxEntries.waveId))
		.where(markOf(contact, normalizeEmail(contact.email)))
		.limit(1);
	const [row] = lock ? await query.for('update', { of: contactBounces }) : await query;
	if (row === undefined) return null;
	// Without an entry (sub-plan 7 may delete it) the area of the contact's kind decides.
	const areaId = row.waveAreaId ?? kindAreaId(await getContactSettings(db), contact.kind);
	return { areaId, at: row.at, source: row.source };
}

/**
 * The mark of a contact's current address, for the contact page.
 *
 * @param db The database.
 * @param contact The contact's kind, key and current address.
 * @returns The mark with the area whose `edit` clears it, or null.
 */
async function bounceMarkOf(db: Db, contact: MarkedContact): Promise<BounceMark | null> {
	return readMark(db, contact, false);
}

/**
 * Whether a user may clear a mark: `edit` in its area. The admin role alone gives nothing.
 *
 * @param principal Who asks.
 * @param mark The mark.
 * @returns True when the user may clear it.
 */
function canClearBounce(principal: Principal, mark: Readonly<BounceMark>): boolean {
	return mark.areaId !== null && canAccessArea(principal, mark.areaId, 'edit');
}

/**
 * The condition that finds the entry of a report.
 *
 * @param entry The Message-ID or the provider's id.
 * @returns The condition.
 */
function entryCondition(entry: BouncedEntry): SQL {
	return 'messageId' in entry
		? eq(outboxEntries.messageId, entry.messageId)
		: eq(outboxEntries.providerId, entry.providerId);
}

/**
 * Finds the entry of a report.
 *
 * @param tx The transaction.
 * @param entry The Message-ID or the provider's id.
 * @returns The entry's id and wave, or undefined for a mail of no entry.
 */
async function findEntry(
	tx: Db,
	entry: BouncedEntry,
): Promise<{ id: string; waveId: string | null } | undefined> {
	const [row] = await tx
		.select({ id: outboxEntries.id, waveId: outboxEntries.waveId })
		.from(outboxEntries)
		.where(entryCondition(entry))
		.limit(1);
	return row;
}

/**
 * The contacts of an entry with the address its mail went to.
 *
 * @param tx The transaction.
 * @param entryId The entry.
 * @returns Them, in their order.
 */
async function contactsOfEntry(
	tx: Db,
	entryId: string,
): Promise<{ kind: ContactKind; contactKey: string; email: string }[]> {
	return tx
		.select({
			contactKey: waveContacts.contactKey,
			email: waveContacts.email,
			kind: waveContacts.kind,
		})
		.from(waveContacts)
		.where(eq(waveContacts.entryId, entryId))
		.orderBy(waveContacts.position);
}

/**
 * Marks the contacts of an entry with the address its mail went to. A mark the address had
 * already now names this entry, its source and its time.
 *
 * @param tx The transaction.
 * @param entryId The entry that bounced.
 * @param input The source and the time of the report.
 */
async function markContacts(
	tx: Db,
	entryId: string,
	input: Readonly<Pick<BounceInput, 'at' | 'source'>>,
): Promise<void> {
	const mark = { createdAt: input.at, entryId, source: input.source };
	for (const contact of await contactsOfEntry(tx, entryId)) {
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		await tx
			.insert(contactBounces)
			.values({ ...contact, ...mark })
			.onConflictDoUpdate({
				set: mark,
				target: [contactBounces.kind, contactBounces.contactKey, contactBounces.email],
			});
	}
}

/**
 * Records a bounce report. A hard bounce sets the entry to `bounced` and marks every contact of
 * the entry (of a circular: all of them, the address is theirs together) with the address the mail
 * went to. A soft bounce only leaves its code on the entry, unless the entry bounced hard before.
 *
 * @param db The database.
 * @param input The entry, whether it is hard, the source and the time.
 * @returns `marked` (hard), `logged` (soft), or `unknown` when no entry has the mail.
 */
async function recordBounce(
	db: Db,
	input: Readonly<BounceInput>,
): Promise<'logged' | 'marked' | 'unknown'> {
	return db.transaction(async (tx) => {
		const entry = await findEntry(tx, input.entry);
		if (entry === undefined) return 'unknown';
		if (!input.hard) {
			await tx
				.update(outboxEntries)
				.set({ lastErrorCode: SOFT_BOUNCE_CODE })
				.where(and(eq(outboxEntries.id, entry.id), ne(outboxEntries.status, 'bounced')));
			return 'logged';
		}
		await tx
			.update(outboxEntries)
			.set({ lastErrorCode: HARD_BOUNCE_CODE, status: 'bounced' })
			.where(eq(outboxEntries.id, entry.id));
		await markContacts(tx, entry.id, input);
		return 'marked';
	});
}

/**
 * The kinds among some contacts, in lock order.
 *
 * @param keyed The contacts.
 * @returns Each kind once.
 */
function kindsOf(keyed: readonly KeyedContact[]): ContactKind[] {
	return KIND_ORDER.filter((kind) => keyed.some((each) => each.kind === kind));
}

/**
 * The area of a wave.
 *
 * @param tx The transaction.
 * @param waveId The wave, or null.
 * @returns Its area, or null without a wave.
 */
async function waveAreaOf(tx: Db, waveId: string | null): Promise<string | null> {
	if (waveId === null) return null;
	const [row] = await tx.select({ areaId: waves.areaId }).from(waves).where(eq(waves.id, waveId));
	return row?.areaId ?? null;
}

/**
 * Opts contacts out of an area without a user, under the import-state locks of their kinds.
 *
 * @param tx The transaction.
 * @param keyed The contacts.
 * @param areaId The area.
 * @returns The contacts whose opt-out is new.
 */
async function optOutOfArea(
	tx: Db,
	keyed: readonly KeyedContact[],
	areaId: string,
): Promise<KeyedContact[]> {
	for (const kind of kindsOf(keyed)) {
		// oxlint-disable-next-line no-await-in-loop -- the locks in a fixed order, one after the other
		await lockImportState(tx, kind);
	}
	const made: KeyedContact[] = [];
	for (const { key, kind } of keyed) {
		const input = { areaId, contactKey: key, kind, occasionId: null, scope: 'area' } as const;
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		if (await optOutByKey(tx, input)) made.push({ key, kind });
	}
	return made;
}

/**
 * Counts new opt-outs of a complaint: bumps the stock version of each kind and logs them per
 * contact, without an actor.
 *
 * @param tx The transaction.
 * @param made The contacts whose opt-out is new.
 * @param change The area and the time of the complaint.
 */
async function logComplaint(
	tx: Db,
	made: readonly KeyedContact[],
	change: Readonly<{ areaId: string; at: Date }>,
): Promise<void> {
	for (const kind of kindsOf(made)) {
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		await bumpStockVersion(tx, kind);
	}
	const details = { areaId: change.areaId, reason: 'complaint' };
	const logged = {
		action: 'contact.opted_out',
		actorUserId: null,
		at: change.at,
		details,
	} as const;
	for (const target of await auditTargetsOfKeys(tx, made)) {
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		await writeAudit(tx, target === null ? logged : { ...logged, target });
	}
}

/**
 * Records a complaint (Resend: the recipient marked the mail as spam) as an opt-out of the wave's
 * area for every contact of the entry, without a user. It waits for a running import of each kind,
 * counts as a change of the stock and is logged per contact by its audit target, never by name or
 * address. A contact that has the opt-out already keeps it, unchanged and unlogged.
 *
 * @param db The database.
 * @param providerId The id Resend gave the mail.
 * @param at When Resend reported it.
 * @returns True when an entry has the mail; false for an unknown one.
 */
async function recordComplaint(db: Db, providerId: string, at: Date): Promise<boolean> {
	return db.transaction(async (tx) => {
		const entry = await findEntry(tx, { providerId });
		if (entry === undefined) return false;
		const areaId = await waveAreaOf(tx, entry.waveId);
		if (areaId === null) return true;
		const contactsOfMail = await contactsOfEntry(tx, entry.id);
		const keyed = contactsOfMail.map(({ contactKey, kind }) => ({ key: contactKey, kind }));
		const made = await optOutOfArea(tx, keyed, areaId);
		await logComplaint(tx, made, { areaId, at });
		return true;
	});
}

/**
 * Clears the mark of a contact's current address. Needs `edit` in the area of the wave the mark
 * came from, or, without an entry, in the area of the contact's kind; the admin role alone gives
 * nothing. Clearing an address without a mark changes nothing and logs nothing.
 *
 * @param db The database.
 * @param actor Who clears.
 * @param contactId The contact.
 * @throws {ForbiddenError} Without `read` in any area, or without `edit` in the mark's area.
 * @throws {ContactNotFoundError} For an unknown contact.
 */
async function clearBounce(db: Db, actor: Principal, contactId: string): Promise<void> {
	const access = await loadContactAccess(db, actor);
	assertCanList(access);
	if (!UUID.test(contactId)) throw new ContactNotFoundError();
	await db.transaction(async (tx) => {
		const [contact] = await tx
			.select({
				contactKey: contacts.contactKey,
				customerNumber: contacts.customerNumber,
				email: contacts.email,
				id: contacts.id,
				kind: contacts.kind,
				memberNumber: contacts.memberNumber,
			})
			.from(contacts)
			.where(eq(contacts.id, contactId));
		if (contact === undefined) throw new ContactNotFoundError();
		const mark = await readMark(tx, contact, true);
		if (mark === null || contact.email === null) return;
		if (!canClearBounce(actor, mark)) throw new ForbiddenError('Forbidden');
		await tx.delete(contactBounces).where(markOf(contact, normalizeEmail(contact.email)));
		await writeAudit(tx, {
			action: 'contact.bounce_cleared',
			actorUserId: actor.userId,
			details: { source: mark.source },
			target: auditTarget(contact),
		});
	});
}

export {
	bounceMarkOf,
	bounceOfContact,
	canClearBounce,
	clearBounce,
	HARD_BOUNCE_CODE,
	isEmailInvalid,
	recordBounce,
	recordComplaint,
	SOFT_BOUNCE_CODE,
};
export type { BounceInput, BounceMark, BounceSource };
