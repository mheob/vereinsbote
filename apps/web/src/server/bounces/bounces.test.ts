import { asc, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { createArea } from '@/server/areas/areas';
import { getContact } from '@/server/contacts/contacts';
import { getImportState } from '@/server/contacts/import-state';
import { insertContact, setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import {
	auditLog,
	contactBounces,
	contactOptOuts,
	contacts,
	outboxEntries,
} from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { insertOccasion } from '@/server/occasions/testing';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { insertWave } from '@/server/waves/testing';

import {
	clearBounce,
	HARD_BOUNCE_CODE,
	isEmailInvalid,
	recordBounce,
	recordComplaint,
	SOFT_BOUNCE_CODE,
} from './bounces';
import { FAMILY, setUpSentWave, SINGLE } from './testing';
import type { SentWave } from './testing';

const ANNA = { contactKey: 'nr:7', email: 'anna@example.org', kind: 'member' } as const;
/** When the provider reported the bounce or the complaint. */
const REPORTED_AT = new Date('2026-11-26T09:30:00.000Z');

type EntryState = Readonly<{ status: string; code: string | null }>;
type OptOutRow = Omit<typeof contactOptOuts.$inferSelect, 'createdAt' | 'id'>;
type LogRow = Pick<typeof auditLog.$inferSelect, 'action' | 'actorUserId' | 'details' | 'target'>;

/**
 * The status and the code of some entries.
 *
 * @param db The database.
 * @param entryIds The entries.
 * @returns Both, in the order of the ids.
 */
async function entryStates(db: Db, entryIds: readonly string[]): Promise<EntryState[]> {
	const rows = await db
		.select({
			code: outboxEntries.lastErrorCode,
			id: outboxEntries.id,
			status: outboxEntries.status,
		})
		.from(outboxEntries)
		.where(inArray(outboxEntries.id, [...entryIds]));
	const byId = new Map(rows.map((row) => [row.id, { code: row.code, status: row.status }]));
	return entryIds.map((id) => byId.get(id) ?? { code: null, status: 'gone' });
}

/**
 * Every marking, by key.
 *
 * @param db The database.
 * @returns The rows.
 */
async function markings(db: Db): Promise<(typeof contactBounces.$inferSelect)[]> {
	return db.select().from(contactBounces).orderBy(asc(contactBounces.contactKey));
}

/**
 * Whether the current addresses of some contacts are marked.
 *
 * @param db The database.
 * @param contactIds The contacts.
 * @returns The answers of `isEmailInvalid`, in the order of the ids; false for a contact gone.
 */
async function markedNow(db: Db, contactIds: readonly string[]): Promise<boolean[]> {
	const rows = await db
		.select()
		.from(contacts)
		.where(inArray(contacts.id, [...contactIds]));
	const answers = new Map<string, boolean>();
	for (const row of rows) {
		// oxlint-disable-next-line no-await-in-loop -- one contact after another
		answers.set(row.id, await isEmailInvalid(db, row));
	}
	return contactIds.map((id) => answers.get(id) ?? false);
}

/**
 * The opt-outs, by key.
 *
 * @param db The database.
 * @returns Their columns but the id and the time.
 */
async function optOutRows(db: Db): Promise<OptOutRow[]> {
	return db
		.select({
			areaId: contactOptOuts.areaId,
			contactKey: contactOptOuts.contactKey,
			createdByUserId: contactOptOuts.createdByUserId,
			kind: contactOptOuts.kind,
			occasionId: contactOptOuts.occasionId,
			scope: contactOptOuts.scope,
		})
		.from(contactOptOuts)
		.orderBy(asc(contactOptOuts.contactKey));
}

/**
 * The log entries of an action, by target.
 *
 * @param db The database.
 * @param action The action.
 * @returns The action, the actor, the details and the target of each.
 */
async function logOf(db: Db, action: LogRow['action']): Promise<LogRow[]> {
	return db
		.select({
			action: auditLog.action,
			actorUserId: auditLog.actorUserId,
			details: auditLog.details,
			target: auditLog.target,
		})
		.from(auditLog)
		.where(eq(auditLog.action, action))
		.orderBy(asc(auditLog.target));
}

/**
 * Records the hard bounce of the family's mail through Graph.
 *
 * @param wave The sent wave.
 * @returns What `recordBounce` answered.
 */
async function bounceFamily(wave: SentWave): Promise<'logged' | 'marked' | 'unknown'> {
	return recordBounce(wave.club.db, {
		at: REPORTED_AT,
		entry: { messageId: wave.family.messageId },
		hard: true,
		source: 'graph',
	});
}

/**
 * Tries to clear the mark of a contact as each of some users.
 *
 * @param db The database.
 * @param users The users.
 * @param contactId The contact.
 * @returns Per user whether it was refused as forbidden.
 */
async function refusals(
	db: Db,
	users: readonly Principal[],
	contactId: string,
): Promise<boolean[]> {
	const refused: boolean[] = [];
	for (const user of users) {
		// oxlint-disable-next-line no-await-in-loop -- one user after another
		const outcome = await clearBounce(db, user, contactId).catch((error: unknown) => error);
		refused.push(outcome instanceof ForbiddenError);
	}
	return refused;
}

describe(isEmailInvalid, () => {
	it.each([
		['the address that bounced', ANNA, true],
		['the address as typed', { ...ANNA, email: ' Anna@Example.org' }, true],
		// An import brought another address: the mark no longer applies.
		['another address', { ...ANNA, email: 'anna.neu@example.org' }, false],
		['the other kind', { ...ANNA, kind: 'partner' }, false],
		['another key', { ...ANNA, contactKey: 'nr:8' }, false],
		['no address', { ...ANNA, email: null }, false],
	] as const)('checks %s', async (_case, contact, invalid) => {
		const db = await createTestDb();
		await db.insert(contactBounces).values({ ...ANNA, source: 'graph' });
		await expect(isEmailInvalid(db, contact)).resolves.toBe(invalid);
	});
});

describe(recordBounce, () => {
	it('marks every contact of a hard bounce and only logs a soft one', async () => {
		const wave = await setUpSentWave();
		const { club, contactIds, family, single } = wave;
		const { db } = club;

		const results = [
			await bounceFamily(wave),
			await recordBounce(db, {
				at: REPORTED_AT,
				entry: { providerId: single.providerId },
				hard: false,
				source: 'resend',
			}),
		];

		expect(results).toStrictEqual(['marked', 'logged']);
		await expect(entryStates(db, [family.id, single.id])).resolves.toStrictEqual([
			{ code: HARD_BOUNCE_CODE, status: 'bounced' },
			{ code: SOFT_BOUNCE_CODE, status: 'sent' },
		]);
		// Both members of the circular, with the address the mail went to.
		const mark = { createdAt: REPORTED_AT, email: FAMILY, entryId: family.id, kind: 'member' };
		await expect(markings(db)).resolves.toStrictEqual([
			{ ...mark, contactKey: 'nr:1', source: 'graph' },
			{ ...mark, contactKey: 'nr:2', source: 'graph' },
		]);
		await expect(
			markedNow(db, [contactIds[1], contactIds[2], contactIds[3]]),
		).resolves.toStrictEqual([true, true, false]);
	});

	it('marks the address a personal mail went to, not the one at the confirmation', async () => {
		const wave = await setUpSentWave('graph', 'personal');
		const { club, contactIds, single } = wave;
		const { db } = club;
		// Member 3 moved after the confirmation: the outbox sent the mail to the new address.
		const moved = 'clara.neu@example.org';
		await db.update(contacts).set({ email: moved }).where(eq(contacts.id, contactIds[3]));
		await db.update(outboxEntries).set({ recipient: moved }).where(eq(outboxEntries.id, single.id));

		await recordBounce(db, {
			at: REPORTED_AT,
			entry: { messageId: single.messageId },
			hard: true,
			source: 'graph',
		});

		const marked = await markings(db);
		expect(marked.map(({ contactKey, email }) => [contactKey, email])).toStrictEqual([
			['nr:3', moved],
		]);
		// The mark applies to the address the contact has now.
		await expect(markedNow(db, [contactIds[3]])).resolves.toStrictEqual([true]);
	});

	it('marks the address of the confirmation when the entry recorded no recipient', async () => {
		const wave = await setUpSentWave();
		const { club, single } = wave;
		await club.db
			.update(outboxEntries)
			.set({ recipient: null })
			.where(eq(outboxEntries.id, single.id));
		await recordBounce(club.db, {
			at: REPORTED_AT,
			entry: { messageId: single.messageId },
			hard: true,
			source: 'graph',
		});
		const marked = await markings(club.db);
		expect(marked.map(({ contactKey, email }) => [contactKey, email])).toStrictEqual([
			['nr:3', SINGLE],
		]);
	});

	it('keeps the hard bounce of an entry when a soft report follows', async () => {
		const wave = await setUpSentWave();
		const { club, family } = wave;
		await bounceFamily(wave);
		await expect(
			recordBounce(club.db, {
				at: REPORTED_AT,
				entry: { messageId: family.messageId },
				hard: false,
				source: 'graph',
			}),
		).resolves.toBe('logged');
		await expect(entryStates(club.db, [family.id])).resolves.toStrictEqual([
			{ code: HARD_BOUNCE_CODE, status: 'bounced' },
		]);
	});

	it('answers unknown for a mail of no entry and changes nothing', async () => {
		const { club, family } = await setUpSentWave();
		const { db } = club;
		const report = { at: REPORTED_AT, hard: true, source: 'resend' } as const;
		const results = [
			await recordBounce(db, { ...report, entry: { messageId: '<anders@example.org>' } }),
			await recordBounce(db, { ...report, entry: { providerId: 're-unbekannt' } }),
		];
		expect(results).toStrictEqual(['unknown', 'unknown']);
		await expect(markings(db)).resolves.toStrictEqual([]);
		await expect(entryStates(db, [family.id])).resolves.toStrictEqual([
			{ code: null, status: 'sent' },
		]);
	});
});

describe(recordComplaint, () => {
	it('turns a complaint into an area opt-out for every contact of the mail', async () => {
		const { club, family } = await setUpSentWave('resend');
		const { db, membersAreaId } = club;
		const before = await getImportState(db, 'member');

		await expect(recordComplaint(db, family.providerId, REPORTED_AT)).resolves.toBe(true);

		const optOut = {
			areaId: membersAreaId,
			createdByUserId: null,
			kind: 'member',
			occasionId: null,
			scope: 'area',
		};
		await expect(optOutRows(db)).resolves.toStrictEqual([
			{ ...optOut, contactKey: 'nr:1' },
			{ ...optOut, contactKey: 'nr:2' },
		]);
		const entry = {
			action: 'contact.opted_out',
			actorUserId: null,
			details: { areaId: membersAreaId, reason: 'complaint' },
		};
		await expect(logOf(db, 'contact.opted_out')).resolves.toStrictEqual([
			{ ...entry, target: 'member:1' },
			{ ...entry, target: 'member:2' },
		]);
		// The opt-outs count as a change of the stock.
		await expect(getImportState(db, 'member')).resolves.toMatchObject({
			stockVersion: before.stockVersion + 1,
		});
	});

	it('changes nothing for a repeated complaint or one of no entry', async () => {
		const { club, family } = await setUpSentWave('resend');
		const { db } = club;
		await recordComplaint(db, family.providerId, REPORTED_AT);

		const results = [
			await recordComplaint(db, family.providerId, REPORTED_AT),
			await recordComplaint(db, 're-unbekannt', REPORTED_AT),
		];

		expect(results).toStrictEqual([true, false]);
		await expect(logOf(db, 'contact.opted_out')).resolves.toHaveLength(2);
		// Member 3's mail was not the one complained about.
		const optedOut = await optOutRows(db);
		expect(optedOut.map(({ contactKey }) => contactKey)).toStrictEqual(['nr:1', 'nr:2']);
	});
});

describe(clearBounce, () => {
	it('lets a new address clear the marking', async () => {
		const wave = await setUpSentWave();
		const { club, contactIds } = wave;
		const { db, editor } = club;
		await bounceFamily(wave);
		// An import brings member 1 a new address; member 2 keeps the family's.
		await db
			.update(contacts)
			.set({ email: 'eins.neu@example.org' })
			.where(eq(contacts.id, contactIds[1]));

		await expect(markedNow(db, [contactIds[1], contactIds[2]])).resolves.toStrictEqual([
			false,
			true,
		]);
		await expect(getContact(db, editor, contactIds[1])).resolves.toMatchObject({ bounce: null });
		await expect(getContact(db, editor, contactIds[2])).resolves.toMatchObject({
			bounce: { at: REPORTED_AT.toISOString(), canClear: true },
		});
	});

	it('lets users with edit clear the marking', async () => {
		const wave = await setUpSentWave();
		const { club, contactIds } = wave;
		const { db, editor, membersAreaId, partnersAreaId } = club;
		await bounceFamily(wave);
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		const partnerEditor = await userWith(db, { [partnersAreaId]: 'edit' });
		// The admin role alone gives no access.
		const adminOnly = await userWith(db, {}, { isAdmin: true });

		await expect(
			refusals(db, [reader, partnerEditor, adminOnly], contactIds[1]),
		).resolves.toStrictEqual([true, true, true]);
		await clearBounce(db, editor, contactIds[1]);
		// Again: nothing left to clear, nothing logged.
		await clearBounce(db, editor, contactIds[1]);

		// Member 2 shares the address but has a marking of its own.
		await expect(markedNow(db, [contactIds[1], contactIds[2]])).resolves.toStrictEqual([
			false,
			true,
		]);
		const logged = await logOf(db, 'contact.bounce_cleared');
		expect(logged).toStrictEqual([
			{
				action: 'contact.bounce_cleared',
				actorUserId: editor.userId,
				details: { source: 'graph' },
				target: 'member:1',
			},
		]);
		expect(JSON.stringify(logged)).not.toContain('@');
	});

	it('shows readers the marking without the right to clear it', async () => {
		const wave = await setUpSentWave();
		await bounceFamily(wave);
		const reader = await userWith(wave.club.db, { [wave.club.membersAreaId]: 'read' });
		await expect(getContact(wave.club.db, reader, wave.contactIds[1])).resolves.toMatchObject({
			bounce: { at: REPORTED_AT.toISOString(), canClear: false },
		});
	});

	it('asks for edit in the area of the wave or of the kind', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const { areaId: youthAreaId } = await createArea(db, admin, 'Jugend');
		const youthWave = await insertWave(db, await insertOccasion(db, admin, youthAreaId));
		const [entry] = await db
			.insert(outboxEntries)
			.values({
				priority: 'group',
				source: 'wave',
				sourceId: youthWave,
				status: 'bounced',
				waveId: youthWave,
			})
			.returning({ id: outboxEntries.id });
		const fromWave = await insertContact(db, {
			email: 'neun@example.org',
			kind: 'member',
			memberNumber: '9',
		});
		const withoutEntry = await insertContact(db, {
			email: SINGLE,
			kind: 'member',
			memberNumber: '10',
		});
		await db.insert(contactBounces).values([
			{
				contactKey: 'nr:9',
				email: 'neun@example.org',
				entryId: entry?.id,
				kind: 'member',
				source: 'graph',
			},
			{ contactKey: 'nr:10', email: SINGLE, entryId: null, kind: 'member', source: 'resend' },
		]);
		const youthEditor = await userWith(db, { [youthAreaId]: 'edit' });
		const membersEditor = await userWith(db, { [membersAreaId]: 'edit' });
		const youthReader = await userWith(db, { [membersAreaId]: 'read', [youthAreaId]: 'read' });
		const adminOnly = await userWith(db, {}, { isAdmin: true });

		// Without an entry only the area of the kind is left.
		await expect(refusals(db, [youthEditor], withoutEntry)).resolves.toStrictEqual([true]);
		await expect(refusals(db, [youthReader, adminOnly], fromWave)).resolves.toStrictEqual([
			true,
			true,
		]);
		// The editors of the members keep their contacts: they clear a mark of the youth's wave.
		await expect(getContact(db, membersEditor, fromWave)).resolves.toMatchObject({
			bounce: { canClear: true },
		});
		await clearBounce(db, membersEditor, fromWave);
		await clearBounce(db, membersEditor, withoutEntry);
		await expect(markings(db)).resolves.toStrictEqual([]);
	});

	it('lets the editors of the wave area clear a mark too', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const { areaId: youthAreaId } = await createArea(db, admin, 'Jugend');
		const youthWave = await insertWave(db, await insertOccasion(db, admin, youthAreaId));
		const [entry] = await db
			.insert(outboxEntries)
			.values({
				priority: 'group',
				source: 'wave',
				sourceId: youthWave,
				status: 'bounced',
				waveId: youthWave,
			})
			.returning({ id: outboxEntries.id });
		const fromWave = await insertContact(db, {
			email: 'neun@example.org',
			kind: 'member',
			memberNumber: '9',
		});
		await db.insert(contactBounces).values({
			contactKey: 'nr:9',
			email: 'neun@example.org',
			entryId: entry?.id,
			kind: 'member',
			source: 'graph',
		});
		const youthEditor = await userWith(db, { [youthAreaId]: 'edit' });

		await clearBounce(db, youthEditor, fromWave);

		await expect(markings(db)).resolves.toStrictEqual([]);
	});
});
