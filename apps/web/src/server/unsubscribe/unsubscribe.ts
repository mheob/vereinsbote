/*
 * Unsubscribing through the link of a mail (Design 12). The token names the contacts of the mail
 * by kind and key (every merged contact of a circular), its occasion and its area. The page names
 * the club, the occasion and the area, never a contact. Unsubscribing records an opt-out without a
 * user for every contact of the mail (`optOutByKey`): on the key, so it holds through every import,
 * also for a contact the stock no longer has. It waits for a running import of each kind
 * (`lockImportState`), counts as a change of the stock and is logged per contact by its audit
 * target, never by name or address. The sealed undo value lets the page take back exactly the
 * opt-outs it made, within 30 minutes.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { getBrand } from '@/server/brand/brand';
import type { ContactKind } from '@/server/contacts/fields';
import { bumpStockVersion, lockImportState } from '@/server/contacts/import-state';
import { auditTarget, optOutByKey } from '@/server/contacts/suppressions';
import type { Db } from '@/server/db/client';
import { areas, contactOptOuts, contacts, occasions } from '@/server/db/schema';

import type { UnsubscribePayload } from './token';
import { openUndo, sealUndo } from './undo';

/** What a recipient unsubscribes from: the occasion of the mail, or every mail of its area. */
type UnsubscribeScope = 'occasion' | 'area';

/** What the unsubscribe page shows: no contact's name or address. */
interface UnsubscribePage {
	readonly clubName: string;
	/** Null when the occasion no longer exists. */
	readonly occasionName: string | null;
	/** Null when the area no longer exists. */
	readonly areaName: string | null;
	/** False for a token that did not open, or whose occasion and area are both gone. */
	readonly valid: boolean;
}

/** The chosen occasion or area no longer exists; nothing was changed. The message names nothing. */
class UnsubscribeTargetGoneError extends Error {
	public constructor() {
		super('The occasion or the area of the unsubscribe no longer exists.');
		this.name = 'UnsubscribeTargetGoneError';
	}
}

/** A contact of an unsubscribe by kind and key. */
type KeyedContact = Readonly<{ kind: ContactKind; key: string }>;

/** What an unsubscribe is from: the scope and its occasion or area. */
type Target = Readonly<{ scope: UnsubscribeScope; targetId: string }>;

/** How long the page may undo an unsubscribe: 30 minutes. */
const UNDO_WINDOW_MS = 1_800_000;

/** The neutral page of a link that names nothing (Design 12): no club, no occasion, no area. */
const INVALID_PAGE: UnsubscribePage = {
	areaName: null,
	clubName: '',
	occasionName: null,
	valid: false,
};

/** The order the import-state locks are taken in, so two writers never wait for each other. */
const KIND_ORDER: readonly ContactKind[] = ['member', 'partner'];

/** The start of the key of a contact with a member or customer number. */
const NUMBER_KEY_PREFIX = 'nr:';

/**
 * Describes the page of a token. A token that did not open asks the database nothing.
 *
 * @param db The database.
 * @param payload The opened token, or null.
 * @returns The club's name and the names of the occasion and the area that still exist; the
 *   neutral invalid page when none of them does.
 */
async function describeUnsubscribe(
	db: Db,
	payload: Readonly<UnsubscribePayload> | null,
): Promise<UnsubscribePage> {
	if (payload === null) return INVALID_PAGE;
	const [occasion] = await db
		.select({ name: occasions.name })
		.from(occasions)
		.where(eq(occasions.id, payload.occasionId));
	const [area] = await db
		.select({ name: areas.name })
		.from(areas)
		.where(eq(areas.id, payload.areaId));
	if (occasion === undefined && area === undefined) return INVALID_PAGE;
	const { brand } = await getBrand(db);
	return {
		areaName: area?.name ?? null,
		clubName: brand.name,
		occasionName: occasion?.name ?? null,
		valid: true,
	};
}

/**
 * The kinds among some contacts, in lock order.
 *
 * @param keyed The contacts.
 * @returns Each kind once.
 */
function kindsOf(keyed: readonly Readonly<{ kind: ContactKind }>[]): ContactKind[] {
	return KIND_ORDER.filter((kind) => keyed.some((each) => each.kind === kind));
}

/**
 * Locks the occasion or area against deletion until the transaction ends.
 *
 * @param tx The transaction.
 * @param target The scope and its occasion or area.
 * @returns Whether it exists.
 */
async function lockTarget(tx: Db, target: Readonly<Target>): Promise<boolean> {
	const { scope, targetId } = target;
	const rows =
		scope === 'occasion'
			? await tx
					.select({ id: occasions.id })
					.from(occasions)
					.where(eq(occasions.id, targetId))
					.for('share')
			: await tx.select({ id: areas.id }).from(areas).where(eq(areas.id, targetId)).for('share');
	return rows.length > 0;
}

/**
 * The condition of the opt-outs of a scope and its occasion or area.
 *
 * @param scope The scope.
 * @param targetId The occasion or the area.
 * @returns The condition.
 */
function targetCondition(scope: UnsubscribeScope, targetId: string): ReturnType<typeof and> {
	return and(
		eq(contactOptOuts.scope, scope),
		scope === 'occasion'
			? eq(contactOptOuts.occasionId, targetId)
			: eq(contactOptOuts.areaId, targetId),
	);
}

/**
 * How the audit log names the contacts of some keys: each contact with the key by its audit target;
 * a key without a contact by its number, or not at all when it is an address.
 *
 * @param tx The transaction.
 * @param keyed The contacts by kind and key.
 * @returns The targets, in the order of the keys.
 */
async function auditTargetsOf(tx: Db, keyed: readonly KeyedContact[]): Promise<(string | null)[]> {
	const keys = [...new Set(keyed.map(({ key }) => key))];
	const rows = await tx
		.select({
			contactKey: contacts.contactKey,
			customerNumber: contacts.customerNumber,
			id: contacts.id,
			kind: contacts.kind,
			memberNumber: contacts.memberNumber,
		})
		.from(contacts)
		.where(inArray(contacts.contactKey, keys))
		.orderBy(contacts.id);
	return keyed.flatMap(({ key, kind }) => {
		const found = rows.filter((row) => row.kind === kind && row.contactKey === key);
		if (found.length > 0) return found.map((row) => auditTarget(row));
		return [
			key.startsWith(NUMBER_KEY_PREFIX) ? `${kind}:${key.slice(NUMBER_KEY_PREFIX.length)}` : null,
		];
	});
}

/**
 * Locks the import state of each kind among some contacts, in a fixed order.
 *
 * @param tx The transaction.
 * @param keyed The contacts.
 */
async function lockKinds(tx: Db, keyed: readonly Readonly<{ kind: ContactKind }>[]): Promise<void> {
	for (const kind of kindsOf(keyed)) {
		// oxlint-disable-next-line no-await-in-loop -- the locks in a fixed order, one after the other
		await lockImportState(tx, kind);
	}
}

/**
 * Counts a change of opt-outs: bumps the stock version of each kind and logs it per contact,
 * without an actor (the recipient acts).
 *
 * @param tx The transaction.
 * @param action What happened.
 * @param keyed The contacts whose opt-out changed, at least one.
 * @param change The scope, its occasion or area, and the time.
 */
// oxlint-disable-next-line max-params -- the transaction, the action, the contacts and the change
async function recordChange(
	tx: Db,
	action: Extract<AuditAction, 'contact.unsubscribe_undone' | 'contact.unsubscribed'>,
	keyed: readonly KeyedContact[],
	change: Readonly<Target & { at: Date }>,
): Promise<void> {
	const { at, scope, targetId } = change;
	for (const kind of kindsOf(keyed)) {
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		await bumpStockVersion(tx, kind);
	}
	const details =
		scope === 'occasion' ? { occasionId: targetId, scope } : { areaId: targetId, scope };
	for (const target of await auditTargetsOf(tx, keyed)) {
		const entry = { action, actorUserId: null, at, details };
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		await writeAudit(tx, target === null ? entry : { ...entry, target });
	}
}

/**
 * Records the opt-out of every contact of a mail.
 *
 * @param tx The transaction, holding the import-state locks of the kinds.
 * @param payload The contacts of the mail.
 * @param target The scope and its occasion or area.
 * @returns The contacts whose opt-out is new, in their order.
 */
async function optOutAll(
	tx: Db,
	payload: Readonly<UnsubscribePayload>,
	target: Readonly<Target>,
): Promise<KeyedContact[]> {
	const { scope, targetId } = target;
	const made: KeyedContact[] = [];
	for (const { key, kind } of payload.contacts) {
		const input = {
			areaId: scope === 'area' ? targetId : null,
			contactKey: key,
			kind,
			occasionId: scope === 'occasion' ? targetId : null,
			scope,
		};
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		if (await optOutByKey(tx, input)) made.push({ key, kind });
	}
	return made;
}

/**
 * The ids of the opt-outs some contacts have for a target.
 *
 * @param tx The transaction.
 * @param keyed The contacts.
 * @param target The scope and its occasion or area.
 * @returns The opt-outs, in the order of the contacts.
 */
async function optOutIds(
	tx: Db,
	keyed: readonly KeyedContact[],
	target: Readonly<Target>,
): Promise<{ id: string; kind: ContactKind }[]> {
	const keys = keyed.map(({ key }) => key);
	const rows = await tx
		.select({
			contactKey: contactOptOuts.contactKey,
			id: contactOptOuts.id,
			kind: contactOptOuts.kind,
		})
		.from(contactOptOuts)
		.where(
			and(targetCondition(target.scope, target.targetId), inArray(contactOptOuts.contactKey, keys)),
		);
	return keyed.flatMap(({ key, kind }) =>
		rows
			.filter((row) => row.kind === kind && row.contactKey === key)
			.map(({ id }) => ({ id, kind })),
	);
}

/**
 * Unsubscribes every contact of a mail from its occasion or its whole area, in one transaction. A
 * contact that has the opt-out already keeps it, unchanged and unlogged.
 *
 * @param db The database.
 * @param key The key of the undo values (`deriveUndoKey`).
 * @param payload The opened token of the mail.
 * @param scope The occasion of the mail, or its area.
 * @param now The instant; the undo value holds it.
 * @returns The sealed undo value: it takes back exactly the opt-outs made here, for 30 minutes.
 * @throws {UnsubscribeTargetGoneError} When the chosen occasion or area no longer exists.
 */
// oxlint-disable-next-line max-params -- the plan's interface, and the key of the undo value
async function unsubscribe(
	db: Db,
	key: CryptoKey,
	payload: Readonly<UnsubscribePayload>,
	scope: UnsubscribeScope,
	now: Date,
): Promise<{ undo: string }> {
	const target: Target = {
		scope,
		targetId: scope === 'occasion' ? payload.occasionId : payload.areaId,
	};
	const optOuts = await db.transaction(async (tx) => {
		await lockKinds(tx, payload.contacts);
		if (!(await lockTarget(tx, target))) throw new UnsubscribeTargetGoneError();
		const made = await optOutAll(tx, payload, target);
		if (made.length === 0) return [];
		await recordChange(tx, 'contact.unsubscribed', made, { ...target, at: now });
		return optOutIds(tx, made, target);
	});
	return { undo: await sealUndo(key, { ...target, at: now, optOuts }) };
}

/**
 * Takes an unsubscribe back: removes exactly the opt-outs it made, not ones the contacts had
 * before. A repeated undo changes nothing and still succeeds.
 *
 * @param db The database.
 * @param key The key of the undo values (`deriveUndoKey`).
 * @param undo The undo value of `unsubscribe`.
 * @param now The instant.
 * @returns True when undone (or undone before); false for a value that does not open or is older
 *   than 30 minutes.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function undoUnsubscribe(db: Db, key: CryptoKey, undo: string, now: Date): Promise<boolean> {
	const record = await openUndo(key, undo);
	if (record === null || now.getTime() - record.at.getTime() > UNDO_WINDOW_MS) return false;
	const { optOuts, scope, targetId } = record;
	if (optOuts.length === 0) return true;
	const ids = optOuts.map(({ id }) => id);
	const order = new Map(ids.map((id, index) => [id, index]));
	await db.transaction(async (tx) => {
		await lockKinds(tx, optOuts);
		const removed = await tx
			.delete(contactOptOuts)
			.where(and(targetCondition(scope, targetId), inArray(contactOptOuts.id, ids)))
			.returning({
				id: contactOptOuts.id,
				key: contactOptOuts.contactKey,
				kind: contactOptOuts.kind,
			});
		if (removed.length === 0) return;
		removed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
		await recordChange(tx, 'contact.unsubscribe_undone', removed, { at: now, scope, targetId });
	});
	return true;
}

export { describeUnsubscribe, undoUnsubscribe, unsubscribe, UnsubscribeTargetGoneError };
export type { UnsubscribePage, UnsubscribeScope };
