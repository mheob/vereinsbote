import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { createArea } from '@/server/areas/areas';
import type { Db } from '@/server/db/client';
import { auditLog, contactOptOuts, contacts, contactSuppressions } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { insertOccasion } from '@/server/occasions/testing';
import { ForbiddenError } from '@/server/permissions/principal';

import { getContact, listContacts } from './contacts';
import { ContactNotFoundError, UnknownAreaError } from './errors';
import { getImportState } from './import-state';
import {
	auditTarget,
	contactKey,
	copyContactKey,
	optOutByKey,
	rekeyContactKey,
	setOptOut,
	setSuppression,
} from './suppressions';
import { insertContact, setUpClub, userWith } from './testing';

/** Any fixed instant; the list needs one for date filters. */
const NOW = new Date('2026-06-14T22:30:00Z');

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/**
 * The stock versions of both kinds.
 *
 * @param db The test database.
 * @returns Member and partner version.
 */
async function stockVersions(db: Db): Promise<[number, number]> {
	const member = await getImportState(db, 'member');
	const partner = await getImportState(db, 'partner');
	return [member.stockVersion, partner.stockVersion];
}

/**
 * The audit entries this module writes, oldest first.
 *
 * @param db The test database.
 * @returns The entries.
 */
async function contactAudit(db: Db): Promise<(typeof auditLog.$inferSelect)[]> {
	const entries = await db.select().from(auditLog).orderBy(auditLog.at);
	return entries.filter((entry) => entry.action.startsWith('contact.'));
}

/**
 * An opt-out row of a partner for one area.
 *
 * @param key The contact key.
 * @param areaId The area.
 * @returns The row to insert.
 */
function areaOptOut(key: string, areaId: string): typeof contactOptOuts.$inferInsert {
	return { areaId, contactKey: key, kind: 'partner', scope: 'area' };
}

describe('contactKey and auditTarget', () => {
	it('agrees with the generated contact_key', async () => {
		const db = await createTestDb();
		const member = await insertContact(db, { kind: 'member', memberNumber: '42' });
		const numbered = await insertContact(db, { customerNumber: '100001', kind: 'partner' });
		const byMail = await insertContact(db, { email: 'info@example.org', kind: 'partner' });
		const rows = await db.select().from(contacts).orderBy(contacts.contactKey);
		expect(rows.map((row) => [row.contactKey, contactKey(row)])).toStrictEqual([
			['email:info@example.org', 'email:info@example.org'],
			['nr:100001', 'nr:100001'],
			['nr:42', 'nr:42'],
		]);
		expect([member, numbered, byMail]).toHaveLength(3);
	});

	it('gives no key without an identifying column', () => {
		const none = { customerNumber: null, email: null, memberNumber: null };
		expect(contactKey({ ...none, kind: 'member' })).toBeNull();
		expect(contactKey({ ...none, kind: 'partner' })).toBeNull();
		// A member never uses an address or a customer number.
		expect(contactKey({ ...none, email: 'a@example.org', kind: 'member' })).toBeNull();
	});

	it('names the number in the audit target, else the id', () => {
		const base = { customerNumber: null, id: 'abc', memberNumber: null };
		expect(auditTarget({ ...base, kind: 'member', memberNumber: '42' })).toBe('member:42');
		expect(auditTarget({ ...base, customerNumber: '7', kind: 'partner' })).toBe('partner:7');
		expect(auditTarget({ ...base, kind: 'partner' })).toBe('contact:abc');
	});
});

describe(setSuppression, () => {
	it('lets only edit in the members area suppress a member', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const id = await insertContact(db, { kind: 'member', memberNumber: '1' });
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		const wrongArea = await userWith(db, { [membersAreaId]: 'read', [partnersAreaId]: 'edit' });
		const nobody = await userWith(db, {});
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		const refused = [reader, wrongArea, nobody].map(async (principal) =>
			expect(setSuppression(db, principal, id, true)).rejects.toBeInstanceOf(ForbiddenError),
		);
		await Promise.all(refused);
		await expect(setSuppression(db, editor, id, true)).resolves.toBeUndefined();
		const rows = await db.select().from(contactSuppressions);
		expect(rows.map((row) => [row.kind, row.contactKey, row.createdByUserId])).toStrictEqual([
			['member', 'nr:1', editor.userId],
		]);
	});

	it('refuses an unknown contact', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		await expect(setSuppression(db, editor, UNKNOWN_ID, true)).rejects.toBeInstanceOf(
			ContactNotFoundError,
		);
		const optOut = setOptOut(db, editor, {
			areaId: membersAreaId,
			contactId: UNKNOWN_ID,
			optedOut: true,
		});
		await expect(optOut).rejects.toBeInstanceOf(ContactNotFoundError);
	});

	it('keeps a suppression when the member is deleted and applies it on return', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		const id = await insertContact(db, { kind: 'member', memberNumber: '42' });
		await setSuppression(db, editor, id, true);
		await db.delete(contacts).where(eq(contacts.id, id));
		await insertContact(db, { kind: 'member', memberNumber: '42' });
		const page = await listContacts(
			db,
			editor,
			{ filters: { suppressed: true }, kind: 'member', page: 1, query: '' },
			NOW,
		);
		expect(page.items.map((item) => [item.number, item.suppressed])).toStrictEqual([['42', true]]);
	});

	it('keys a partner without customer number by email', async () => {
		const db = await createTestDb();
		const { partnersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [partnersAreaId]: 'edit' });
		const id = await insertContact(db, { email: 'info@example.org', kind: 'partner' });
		await setSuppression(db, editor, id, true);
		const rows = await db.select().from(contactSuppressions);
		expect(rows.map((row) => [row.kind, row.contactKey])).toStrictEqual([
			['partner', 'email:info@example.org'],
		]);
		await setSuppression(db, editor, id, false);
		await expect(db.select().from(contactSuppressions)).resolves.toStrictEqual([]);
	});

	it('bumps the stock version of the kind only on a real change', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		const id = await insertContact(db, { kind: 'member', memberNumber: '5' });
		await setSuppression(db, editor, id, true);
		await setSuppression(db, editor, id, true);
		await expect(stockVersions(db)).resolves.toStrictEqual([1, 0]);
		await setSuppression(db, editor, id, false);
		await setSuppression(db, editor, id, false);
		await expect(stockVersions(db)).resolves.toStrictEqual([2, 0]);
		const entries = await contactAudit(db);
		expect(entries.map((entry) => [entry.action, entry.target])).toStrictEqual([
			['contact.suppressed', 'member:5'],
			['contact.unsuppressed', 'member:5'],
		]);
	});

	it('names the number in the audit log, never the address', async () => {
		const db = await createTestDb();
		const { partnersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [partnersAreaId]: 'edit' });
		const byMail = await insertContact(db, { email: 'info@example.org', kind: 'partner' });
		const numbered = await insertContact(db, { customerNumber: '100001', kind: 'partner' });
		await setSuppression(db, editor, byMail, true);
		await setSuppression(db, editor, numbered, true);
		const entries = await contactAudit(db);
		expect(entries.map((entry) => entry.target)).toStrictEqual([
			`contact:${byMail}`,
			'partner:100001',
		]);
		expect(JSON.stringify(entries)).not.toContain('@example.org');
	});
});

describe(setOptOut, () => {
	it('records opt-outs per area and drops them with their area', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const { areaId: youthId } = await createArea(db, admin, 'Jugend');
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		const id = await insertContact(db, { kind: 'member', memberNumber: '9' });
		await setOptOut(db, editor, { areaId: youthId, contactId: id, optedOut: true });
		await setOptOut(db, editor, { areaId: youthId, contactId: id, optedOut: true });
		const before = await getContact(db, editor, id);
		expect(before?.optOuts.map((optOut) => optOut.areaName)).toStrictEqual(['Jugend']);
		const entries = await contactAudit(db);
		expect(entries.map((entry) => [entry.action, entry.target, entry.details])).toStrictEqual([
			['contact.opted_out', 'member:9', { areaId: youthId }],
		]);
		await expect(stockVersions(db)).resolves.toStrictEqual([1, 0]);

		await db.execute(`delete from areas where id = '${youthId}'`);
		const after = await getContact(db, editor, id);
		expect(after?.optOuts).toStrictEqual([]);
		await expect(db.select().from(contactOptOuts)).resolves.toStrictEqual([]);
	});

	it('removes an opt-out once and logs it once', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const { areaId: youthId } = await createArea(db, admin, 'Jugend');
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		const id = await insertContact(db, { kind: 'member', memberNumber: '9' });
		await setOptOut(db, editor, { areaId: youthId, contactId: id, optedOut: true });
		await setOptOut(db, editor, { areaId: youthId, contactId: id, optedOut: false });
		await setOptOut(db, editor, { areaId: youthId, contactId: id, optedOut: false });
		await expect(stockVersions(db)).resolves.toStrictEqual([2, 0]);
		const entries = await contactAudit(db);
		expect(entries.map((entry) => entry.action)).toStrictEqual([
			'contact.opted_out',
			'contact.opt_out_removed',
		]);
	});

	it('refuses an unknown area and changes nothing', async () => {
		const db = await createTestDb();
		const { partnersAreaId } = await setUpClub(db);
		const id = await insertContact(db, { email: 'info@example.org', kind: 'partner' });
		const partnerEditor = await userWith(db, { [partnersAreaId]: 'edit' });
		const set = setOptOut(db, partnerEditor, { areaId: UNKNOWN_ID, contactId: id, optedOut: true });
		await expect(set).rejects.toThrow(new UnknownAreaError());
		const clear = setOptOut(db, partnerEditor, {
			areaId: UNKNOWN_ID,
			contactId: id,
			optedOut: false,
		});
		await expect(clear).rejects.toBeInstanceOf(UnknownAreaError);
		await expect(db.select().from(contactOptOuts)).resolves.toStrictEqual([]);
		await expect(contactAudit(db)).resolves.toStrictEqual([]);
		await expect(stockVersions(db)).resolves.toStrictEqual([0, 0]);
	});

	it('refuses a user who may not manage the kind', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const reader = await userWith(db, { [membersAreaId]: 'read', [partnersAreaId]: 'edit' });
		const id = await insertContact(db, { kind: 'member', memberNumber: '9' });
		await expect(
			setOptOut(db, reader, { areaId: partnersAreaId, contactId: id, optedOut: true }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});
});

describe(optOutByKey, () => {
	it('records an opt-out by key without a user, once per scope and target', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const occasionId = await insertOccasion(db, admin, membersAreaId);
		const ofOccasion = {
			areaId: null,
			contactKey: 'nr:42',
			kind: 'member',
			occasionId,
			scope: 'occasion',
		} as const;
		const ofArea = {
			...ofOccasion,
			areaId: membersAreaId,
			occasionId: null,
			scope: 'area',
		} as const;
		const made = [
			await optOutByKey(db, ofOccasion),
			await optOutByKey(db, ofOccasion),
			await optOutByKey(db, ofArea),
			await optOutByKey(db, ofArea),
		];
		expect(made).toStrictEqual([true, false, true, false]);
		const rows = await db.select().from(contactOptOuts).orderBy(contactOptOuts.scope);
		expect(
			rows.map((row) => [
				row.scope,
				row.kind,
				row.contactKey,
				row.areaId,
				row.occasionId,
				row.createdByUserId,
			]),
		).toStrictEqual([
			['area', 'member', 'nr:42', membersAreaId, null, null],
			['occasion', 'member', 'nr:42', null, occasionId, null],
		]);
		// The caller bumps the stock version and writes the log.
		await expect(contactAudit(db)).resolves.toStrictEqual([]);
		await expect(stockVersions(db)).resolves.toStrictEqual([0, 0]);
	});
});

describe(rekeyContactKey, () => {
	it('rekeys suppression and opt-outs without duplicating', async () => {
		const db = await createTestDb();
		const { admin, partnersAreaId } = await setUpClub(db);
		const { areaId: youthId } = await createArea(db, admin, 'Jugend');
		await db.insert(contactSuppressions).values([
			{ contactKey: 'email:x@example.org', kind: 'partner' },
			{ contactKey: 'nr:100009', kind: 'partner' },
			{ contactKey: 'email:x@example.org', kind: 'member' },
		]);
		const occasionId = await insertOccasion(db, admin, youthId);
		await db
			.insert(contactOptOuts)
			.values([
				areaOptOut('email:x@example.org', partnersAreaId),
				areaOptOut('email:x@example.org', youthId),
				areaOptOut('nr:100009', youthId),
				{ contactKey: 'email:x@example.org', kind: 'partner', occasionId, scope: 'occasion' },
				{ contactKey: 'nr:100009', kind: 'partner', occasionId, scope: 'occasion' },
			]);

		await db.transaction(async (tx) =>
			rekeyContactKey(tx, 'partner', 'email:x@example.org', 'nr:100009'),
		);

		const suppressions = await db.select().from(contactSuppressions);
		expect(suppressions.map((row) => `${row.kind} ${row.contactKey}`).toSorted()).toStrictEqual([
			'member email:x@example.org',
			'partner nr:100009',
		]);
		const optOuts = await db.select().from(contactOptOuts);
		expect(
			optOuts.map((row) => `${row.contactKey} ${row.scope} ${row.areaId}`).toSorted(),
		).toStrictEqual(
			[
				`nr:100009 area ${partnersAreaId}`,
				`nr:100009 area ${youthId}`,
				'nr:100009 occasion null',
			].toSorted(),
		);
	});
});

describe(copyContactKey, () => {
	it('copies suppression and opt-outs and keeps them under the old key', async () => {
		const db = await createTestDb();
		const { admin, partnersAreaId } = await setUpClub(db);
		const { areaId: youthId } = await createArea(db, admin, 'Jugend');
		await db
			.insert(contactSuppressions)
			.values({ contactKey: 'email:x@example.org', kind: 'partner' });
		await db
			.insert(contactOptOuts)
			.values([
				areaOptOut('email:x@example.org', partnersAreaId),
				areaOptOut('email:x@example.org', youthId),
				areaOptOut('email:y@example.org', youthId),
			]);

		await db.transaction(async (tx) =>
			copyContactKey(tx, 'partner', 'email:x@example.org', 'email:y@example.org'),
		);

		const suppressions = await db.select().from(contactSuppressions);
		expect(suppressions.map((row) => row.contactKey).toSorted()).toStrictEqual([
			'email:x@example.org',
			'email:y@example.org',
		]);
		const optOuts = await db.select().from(contactOptOuts);
		expect(optOuts.map((row) => `${row.contactKey} ${row.areaId}`).toSorted()).toStrictEqual(
			[
				`email:x@example.org ${partnersAreaId}`,
				`email:x@example.org ${youthId}`,
				`email:y@example.org ${partnersAreaId}`,
				`email:y@example.org ${youthId}`,
			].toSorted(),
		);
	});
});
