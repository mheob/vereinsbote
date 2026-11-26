import { describe, expect, it } from 'vite-plus/test';

import { contactOptOuts, contacts } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { insertOccasion } from '@/server/occasions/testing';

import { insertContact, setUpClub } from './testing';

/**
 * Waits for a query that must fail and returns the message of the driver's error, which names
 * the violated constraint (Drizzle's own message only repeats the statement).
 *
 * @param query The query.
 * @returns The message of the error's cause.
 */
async function causeMessageOf(query: PromiseLike<unknown>): Promise<string> {
	try {
		await query;
	} catch (error) {
		return error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
	}
	throw new Error('The query succeeded.');
}

describe('contacts table', () => {
	it('derives the contact key from the number or the address', async () => {
		const db = await createTestDb();
		await insertContact(db, { kind: 'member', memberNumber: '42' });
		await insertContact(db, { customerNumber: 'K-7', email: 'k@example.org', kind: 'partner' });
		await insertContact(db, { email: 'p@example.org', kind: 'partner' });
		const rows = await db.select({ key: contacts.contactKey }).from(contacts);
		expect(rows.map((row) => row.key).toSorted()).toStrictEqual([
			'email:p@example.org',
			'nr:42',
			'nr:K-7',
		]);
	});

	it('refuses wrong combinations of kind and numbers', async () => {
		const db = await createTestDb();
		const refused = [
			{ kind: 'member' as const },
			{ customerNumber: 'K-1', kind: 'member' as const, memberNumber: '1' },
			{ email: 'x@example.org', kind: 'partner' as const, memberNumber: '1' },
			{ kind: 'partner' as const },
		];
		for (const values of refused) {
			// oxlint-disable-next-line no-await-in-loop -- one attempt after the other on the single test connection
			await expect(db.insert(contacts).values(values)).rejects.toThrow(Error);
		}
		await expect(db.select().from(contacts)).resolves.toHaveLength(0);
	});

	it('keeps member numbers and customer numbers unique', async () => {
		const db = await createTestDb();
		await insertContact(db, { kind: 'member', memberNumber: '1' });
		await insertContact(db, { customerNumber: 'K-1', kind: 'partner' });
		await expect(insertContact(db, { kind: 'member', memberNumber: '1' })).rejects.toThrow(Error);
		await expect(insertContact(db, { customerNumber: 'K-1', kind: 'partner' })).rejects.toThrow(
			Error,
		);
	});

	it('allows an opt-out for an area once per contact', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const optOut = {
			areaId: membersAreaId,
			contactKey: 'nr:1',
			kind: 'member' as const,
			scope: 'area' as const,
		};
		await db.insert(contactOptOuts).values(optOut);
		await expect(causeMessageOf(db.insert(contactOptOuts).values(optOut))).resolves.toContain(
			'contact_opt_outs_area_idx',
		);
	});

	it('accepts one valid opt-out per scope', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const occasionId = await insertOccasion(db, admin, membersAreaId);
		const base = { contactKey: 'nr:1', kind: 'member' as const };
		await db.insert(contactOptOuts).values({ ...base, areaId: membersAreaId, scope: 'area' });
		await db.insert(contactOptOuts).values({ ...base, occasionId, scope: 'occasion' });
		await expect(db.select().from(contactOptOuts)).resolves.toHaveLength(2);
	});

	it.each([
		{ name: 'an occasion without an occasion', scope: 'occasion', targets: () => ({}) },
		{
			name: 'an occasion with both ids',
			scope: 'occasion',
			targets: (areaId: string) => ({ areaId, occasionId: crypto.randomUUID() }),
		},
		{
			name: 'an occasion with an area only',
			scope: 'occasion',
			targets: (areaId: string) => ({ areaId }),
		},
		{ name: 'an area without an area', scope: 'area', targets: () => ({}) },
		{
			name: 'an area with both ids',
			scope: 'area',
			targets: (areaId: string) => ({ areaId, occasionId: crypto.randomUUID() }),
		},
		{
			name: 'an area with an occasion only',
			scope: 'area',
			targets: () => ({ occasionId: crypto.randomUUID() }),
		},
	] as const)('refuses $name', async ({ scope, targets }) => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const insert = db
			.insert(contactOptOuts)
			.values({ ...targets(membersAreaId), contactKey: 'nr:1', kind: 'member', scope });
		await expect(causeMessageOf(insert)).resolves.toContain('contact_opt_outs_target_check');
		await expect(db.select().from(contactOptOuts)).resolves.toHaveLength(0);
	});
});
