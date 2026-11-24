import { describe, expect, it } from 'vite-plus/test';

import { contactOptOuts, contacts } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import { insertContact, setUpClub } from './testing';

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

	it('allows an opt-out for an area once per contact, and for an occasion without a area', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const optOut = {
			areaId: membersAreaId,
			contactKey: 'nr:1',
			kind: 'member' as const,
			scope: 'area' as const,
		};
		await db.insert(contactOptOuts).values(optOut);
		await expect(db.insert(contactOptOuts).values(optOut)).rejects.toThrow(Error);
		await expect(
			db
				.insert(contactOptOuts)
				.values({ ...optOut, contactKey: 'nr:2', occasionId: crypto.randomUUID() }),
		).rejects.toThrow(Error);
		await db.insert(contactOptOuts).values({
			contactKey: 'nr:1',
			kind: 'member',
			occasionId: crypto.randomUUID(),
			scope: 'occasion',
		});
		await expect(db.select().from(contactOptOuts)).resolves.toHaveLength(2);
	});
});
