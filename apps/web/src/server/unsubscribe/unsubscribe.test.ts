import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { getImportState } from '@/server/contacts/import-state';
import { confirmMemberImport, previewMemberImport } from '@/server/contacts/import/members';
import { memberPayload } from '@/server/contacts/import/testing';
import { insertContact, setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { areas, auditLog, contactOptOuts, contacts, occasions } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { insertOccasion } from '@/server/occasions/testing';
import type { Principal } from '@/server/permissions/principal';
import { contactsWithMarks } from '@/server/waves/recipients';

import type { UnsubscribePayload } from './token';
import { deriveUndoKey, sealUndo } from './undo';
import {
	describeUnsubscribe,
	undoUnsubscribe,
	unsubscribe,
	UnsubscribeTargetGoneError,
} from './unsubscribe';

const NOW = new Date('2026-11-26T09:00:00.000Z');
const MINUTE = 60_000;
const APP_SECRET = new Uint8Array(32).fill(4);
const OTHER_SECRET = new Uint8Array(32).fill(5);
const FAMILY = 'familie@example.org';

/** A club with an occasion in the members area and a household of two members and a partner. */
interface Household {
	readonly db: Db;
	readonly admin: Principal;
	readonly membersAreaId: string;
	readonly occasionId: string;
	/** The contacts by name: two members at one address and a partner without customer number. */
	readonly ids: Readonly<{ anna: string; ben: string; firma: string }>;
	/** The payload of the mail the household got. */
	readonly payload: UnsubscribePayload;
}

/**
 * Sets up a club with a household that got one mail of an occasion.
 *
 * @returns The club, the contacts and the payload of their mail.
 */
async function household(): Promise<Household> {
	const db = await createTestDb();
	const { admin, membersAreaId } = await setUpClub(db);
	const occasionId = await insertOccasion(db, admin, membersAreaId, 'Sommerfest');
	const anna = await insertContact(db, {
		email: FAMILY,
		firstName: 'Anna',
		kind: 'member',
		lastName: 'Beispiel',
		memberNumber: '4711',
	});
	const ben = await insertContact(db, {
		email: FAMILY,
		firstName: 'Ben',
		kind: 'member',
		lastName: 'Beispiel',
		memberNumber: '4712',
	});
	const firma = await insertContact(db, { email: FAMILY, kind: 'partner', lastName: 'Firma' });
	const payload: UnsubscribePayload = {
		areaId: membersAreaId,
		contacts: [
			{ key: 'nr:4711', kind: 'member' },
			{ key: 'nr:4712', kind: 'member' },
			{ key: `email:${FAMILY}`, kind: 'partner' },
		],
		occasionId,
	};
	return { admin, db, ids: { anna, ben, firma }, membersAreaId, occasionId, payload };
}

/**
 * The opt-out marks of contacts for the household's occasion.
 *
 * @param h The household.
 * @param ids The contacts.
 * @returns Per contact: opted out of the occasion, opted out of the area.
 */
async function marks(h: Household, ids: readonly string[]): Promise<[boolean, boolean][]> {
	const rows = await contactsWithMarks(h.db, { areaId: h.membersAreaId, id: h.occasionId }, ids);
	return ids.map((id) => {
		const row = rows.find((each) => each.contact.id === id);
		return [row?.optedOutOccasion ?? false, row?.optedOutArea ?? false];
	});
}

/**
 * The unsubscribe entries of the audit log, oldest first.
 *
 * @param db The database.
 * @returns Action, actor, target and details of each.
 */
async function unsubscribeAudit(
	db: Db,
): Promise<[string, string | null, string | null, unknown][]> {
	const rows = await db.select().from(auditLog).orderBy(auditLog.id);
	return rows
		.filter(({ action }) => action.startsWith('contact.unsubscribe'))
		.map(({ action, actorUserId, details, target }) => [action, actorUserId, target, details]);
}

/**
 * The stock versions of both kinds.
 *
 * @param db The database.
 * @returns Member and partner version.
 */
async function stockVersions(db: Db): Promise<[number, number]> {
	const member = await getImportState(db, 'member');
	const partner = await getImportState(db, 'partner');
	return [member.stockVersion, partner.stockVersion];
}

/**
 * Imports members as a file of the club's export, confirming the deletions the preview names.
 *
 * @param h The household.
 * @param importer A user with `edit` in the members area.
 * @param numbers The member numbers of the file, all at the household's address.
 */
async function importMembers(
	h: Household,
	importer: Principal,
	numbers: readonly string[],
): Promise<void> {
	const payload = memberPayload(
		numbers.map((number) => [number, 'Anna', 'Beispiel', FAMILY, '17.05.1980', '-', '', '', '']),
	);
	const preview = await previewMemberImport(h.db, importer, payload, NOW);
	const result = await confirmMemberImport(
		h.db,
		importer,
		payload,
		{ confirmedDeletions: preview.confirmation.deletions, stockVersion: preview.stockVersion },
		NOW,
	);
	if (!result.ok) throw new Error('The import failed.');
}

/**
 * The id of the member with a number.
 *
 * @param db The database.
 * @param memberNumber The number.
 * @returns The id.
 */
async function memberId(db: Db, memberNumber: string): Promise<string> {
	const [row] = await db
		.select({ id: contacts.id })
		.from(contacts)
		.where(eq(contacts.memberNumber, memberNumber));
	if (row === undefined) throw new Error(`Member ${memberNumber} is missing.`);
	return row.id;
}

/**
 * The undo value of an unsubscribe that made opt-outs.
 *
 * @param result What `unsubscribe` returned.
 * @param result.undo The undo value, or null.
 * @returns The undo value.
 */
function undoOf({ undo }: Readonly<{ undo: string | null }>): string {
	if (undo === null) throw new Error('The unsubscribe made no opt-out.');
	return undo;
}

describe(unsubscribe, () => {
	it('opts out every contact of the mail from the occasion', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		const before = await stockVersions(h.db);
		await unsubscribe(h.db, key, h.payload, 'occasion', NOW);
		const { anna, ben, firma } = h.ids;
		await expect(marks(h, [anna, ben, firma])).resolves.toStrictEqual([
			[true, false],
			[true, false],
			[true, false],
		]);
		await expect(stockVersions(h.db)).resolves.toStrictEqual([before[0] + 1, before[1] + 1]);
		const details = { occasionId: h.occasionId, scope: 'occasion' };
		await expect(unsubscribeAudit(h.db)).resolves.toStrictEqual([
			['contact.unsubscribed', null, 'member:4711', details],
			['contact.unsubscribed', null, 'member:4712', details],
			['contact.unsubscribed', null, `contact:${firma}`, details],
		]);
		const rows = await h.db.select().from(contactOptOuts);
		expect(rows.map(({ createdByUserId }) => createdByUserId)).toStrictEqual([null, null, null]);
	});

	it('opts out from the whole area when chosen', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		await unsubscribe(h.db, key, h.payload, 'area', NOW);
		const { anna, ben, firma } = h.ids;
		await expect(marks(h, [anna, ben, firma])).resolves.toStrictEqual([
			[false, true],
			[false, true],
			[false, true],
		]);
		const details = { areaId: h.membersAreaId, scope: 'area' };
		await expect(unsubscribeAudit(h.db)).resolves.toStrictEqual([
			['contact.unsubscribed', null, 'member:4711', details],
			['contact.unsubscribed', null, 'member:4712', details],
			['contact.unsubscribed', null, `contact:${firma}`, details],
		]);
	});

	it('is idempotent and survives an import', async () => {
		const h = await household();
		const importer = await userWith(h.db, { [h.membersAreaId]: 'edit' });
		const key = await deriveUndoKey(APP_SECRET);
		await unsubscribe(h.db, key, h.payload, 'occasion', NOW);
		const versions = await stockVersions(h.db);
		await unsubscribe(h.db, key, h.payload, 'occasion', NOW);
		await expect(stockVersions(h.db)).resolves.toStrictEqual(versions);
		await expect(unsubscribeAudit(h.db)).resolves.toHaveLength(3);
		await expect(h.db.select().from(contactOptOuts)).resolves.toHaveLength(3);
		// An import drops member 4711, the next one brings it back as a new contact.
		await importMembers(h, importer, ['4712']);
		await importMembers(h, importer, ['4711', '4712']);
		const returned = await memberId(h.db, '4711');
		expect(returned).not.toBe(h.ids.anna);
		await expect(marks(h, [returned, h.ids.ben])).resolves.toStrictEqual([
			[true, false],
			[true, false],
		]);
	});

	it('gives no undo value when every contact had the opt-out already', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		const first = await unsubscribe(h.db, key, h.payload, 'occasion', NOW);
		expect(first.undo).toBeTypeOf('string');
		// The mail client's one-click came first: the page then has nothing to undo.
		await expect(unsubscribe(h.db, key, h.payload, 'occasion', NOW)).resolves.toStrictEqual({
			undo: null,
		});
	});

	it('records the opt-out of a contact that is not in the stock, by its key', async () => {
		const h = await household();
		const payload: UnsubscribePayload = {
			...h.payload,
			contacts: [
				{ key: 'nr:9999', kind: 'member' },
				{ key: 'email:weg@example.org', kind: 'partner' },
			],
		};
		await unsubscribe(h.db, await deriveUndoKey(APP_SECRET), payload, 'area', NOW);
		await expect(h.db.select().from(contactOptOuts)).resolves.toHaveLength(2);
		const details = { areaId: h.membersAreaId, scope: 'area' };
		// The log never names an address: a partner without number and without contact has no target.
		await expect(unsubscribeAudit(h.db)).resolves.toStrictEqual([
			['contact.unsubscribed', null, 'member:9999', details],
			['contact.unsubscribed', null, null, details],
		]);
	});

	it('refuses an occasion or area that no longer exists and changes nothing', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		await h.db.delete(occasions).where(eq(occasions.id, h.occasionId));
		await expect(unsubscribe(h.db, key, h.payload, 'occasion', NOW)).rejects.toBeInstanceOf(
			UnsubscribeTargetGoneError,
		);
		const gone = { ...h.payload, areaId: '00000000-0000-4000-8000-000000000000' };
		await expect(unsubscribe(h.db, key, gone, 'area', NOW)).rejects.toBeInstanceOf(
			UnsubscribeTargetGoneError,
		);
		await expect(h.db.select().from(contactOptOuts)).resolves.toStrictEqual([]);
		await expect(unsubscribeAudit(h.db)).resolves.toStrictEqual([]);
	});
});

describe(undoUnsubscribe, () => {
	it('undoes within 30 minutes and not later', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		const undo = undoOf(await unsubscribe(h.db, key, h.payload, 'occasion', NOW));
		const inTime = new Date(NOW.getTime() + 30 * MINUTE);
		await expect(undoUnsubscribe(h.db, key, undo, inTime)).resolves.toBe(true);
		const { anna, ben, firma } = h.ids;
		await expect(marks(h, [anna, ben, firma])).resolves.toStrictEqual([
			[false, false],
			[false, false],
			[false, false],
		]);
		const again = await unsubscribe(h.db, key, h.payload, 'area', NOW);
		const tooLate = new Date(NOW.getTime() + 30 * MINUTE + 1);
		await expect(undoUnsubscribe(h.db, key, undoOf(again), tooLate)).resolves.toBe(false);
		await expect(marks(h, [anna])).resolves.toStrictEqual([[false, true]]);
	});

	it('logs the undo per contact and changes nothing when repeated', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		const undo = undoOf(await unsubscribe(h.db, key, h.payload, 'occasion', NOW));
		const versions = await stockVersions(h.db);
		await undoUnsubscribe(h.db, key, undo, NOW);
		await expect(stockVersions(h.db)).resolves.toStrictEqual([versions[0] + 1, versions[1] + 1]);
		const details = { occasionId: h.occasionId, scope: 'occasion' };
		const undone = [
			['contact.unsubscribe_undone', null, 'member:4711', details],
			['contact.unsubscribe_undone', null, 'member:4712', details],
			['contact.unsubscribe_undone', null, `contact:${h.ids.firma}`, details],
		];
		await expect(unsubscribeAudit(h.db)).resolves.toStrictEqual([
			...undone.map(([, ...rest]) => ['contact.unsubscribed', ...rest]),
			...undone,
		]);
		await expect(undoUnsubscribe(h.db, key, undo, NOW)).resolves.toBe(true);
		await expect(unsubscribeAudit(h.db)).resolves.toHaveLength(6);
		await expect(stockVersions(h.db)).resolves.toStrictEqual([versions[0] + 1, versions[1] + 1]);
	});

	it('removes only the opt-outs this unsubscribe made', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		await h.db.insert(contactOptOuts).values({
			contactKey: 'nr:4711',
			kind: 'member',
			occasionId: h.occasionId,
			scope: 'occasion',
		});
		const undo = undoOf(await unsubscribe(h.db, key, h.payload, 'occasion', NOW));
		await expect(unsubscribeAudit(h.db)).resolves.toHaveLength(2);
		await expect(undoUnsubscribe(h.db, key, undo, NOW)).resolves.toBe(true);
		const { anna, ben, firma } = h.ids;
		await expect(marks(h, [anna, ben, firma])).resolves.toStrictEqual([
			[true, false],
			[false, false],
			[false, false],
		]);
	});

	it('does not report an undo that would change nothing', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		const empty = await sealUndo(key, {
			at: NOW,
			optOuts: [],
			scope: 'occasion',
			targetId: h.occasionId,
		});
		await expect(undoUnsubscribe(h.db, key, empty, NOW)).resolves.toBe(false);
	});

	it('refuses a changed or foreign undo value and changes nothing', async () => {
		const h = await household();
		const key = await deriveUndoKey(APP_SECRET);
		const undo = undoOf(await unsubscribe(h.db, key, h.payload, 'occasion', NOW));
		const cut = undo.slice(0, -1);
		await expect(undoUnsubscribe(h.db, key, cut, NOW)).resolves.toBe(false);
		await expect(undoUnsubscribe(h.db, key, 'not an undo value', NOW)).resolves.toBe(false);
		const foreign = await deriveUndoKey(OTHER_SECRET);
		await expect(undoUnsubscribe(h.db, foreign, undo, NOW)).resolves.toBe(false);
		await expect(h.db.select().from(contactOptOuts)).resolves.toHaveLength(3);
	});
});

describe(describeUnsubscribe, () => {
	it('describes the page without names or addresses', async () => {
		const h = await household();
		const page = await describeUnsubscribe(h.db, h.payload);
		const [area] = await h.db
			.select({ name: areas.name })
			.from(areas)
			.where(eq(areas.id, h.membersAreaId));
		expect(page).toStrictEqual({
			areaName: area?.name,
			clubName: 'Verein',
			occasionName: 'Sommerfest',
			valid: true,
		});
		expect(JSON.stringify(page)).not.toMatch(/Anna|Ben|Beispiel|Firma|familie|4711/u);
	});

	it('offers only what still exists, and nothing when neither does', async () => {
		const h = await household();
		await h.db.delete(occasions).where(eq(occasions.id, h.occasionId));
		await expect(describeUnsubscribe(h.db, h.payload)).resolves.toMatchObject({
			occasionName: null,
			valid: true,
		});
		const nowhere = { ...h.payload, areaId: '00000000-0000-4000-8000-000000000000' };
		await expect(describeUnsubscribe(h.db, nowhere)).resolves.toStrictEqual({
			areaName: null,
			clubName: '',
			occasionName: null,
			valid: false,
		});
	});

	it('asks the database nothing for a token that did not open', async () => {
		const queries: string[] = [];
		const db = await createTestDb({
			logQuery: (query) => {
				queries.push(query);
			},
		});
		queries.length = 0;
		await expect(describeUnsubscribe(db, null)).resolves.toStrictEqual({
			areaName: null,
			clubName: '',
			occasionName: null,
			valid: false,
		});
		expect(queries).toStrictEqual([]);
	});
});
