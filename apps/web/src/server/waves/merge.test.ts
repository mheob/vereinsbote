import { describe, expect, it } from 'vite-plus/test';

import type { ContactRecord } from '@/server/db/schema';

import { planMails } from './merge';
import type { PlannedMail } from './merge';

const CREATED = new Date('2026-01-01T00:00:00.000Z');

/**
 * A contact as the database returns it.
 *
 * @param values The columns that matter for the test.
 * @param values.id The id.
 * @param values.kind The kind.
 * @param values.email The address.
 * @param values.memberNumber The member number of a member.
 * @param values.customerNumber The customer number of a partner, if any.
 * @returns The record.
 */
function contact(
	values: Readonly<{
		id: string;
		kind: ContactRecord['kind'];
		email: string | null;
		memberNumber?: string;
		customerNumber?: string;
	}>,
): ContactRecord {
	const memberNumber = values.memberNumber ?? null;
	const customerNumber = values.customerNumber ?? null;
	let contactKey = `email:${values.email ?? ''}`;
	if (memberNumber !== null) contactKey = `nr:${memberNumber}`;
	if (customerNumber !== null) contactKey = `nr:${customerNumber}`;
	return {
		birthDate: null,
		city: null,
		contactKey,
		createdAt: CREATED,
		customValues: {},
		customerNumber,
		email: values.email,
		entryDate: null,
		exitDate: null,
		firstName: null,
		gender: 'unspecified',
		groups: [],
		id: values.id,
		kind: values.kind,
		lastName: null,
		memberNumber,
		organization: null,
		postalCode: null,
		street: null,
		tags: [],
		updatedAt: CREATED,
	};
}

/**
 * The ids of the contacts of each planned mail, with its address.
 *
 * @param mails The planned mails.
 * @returns Address and ids per mail.
 */
function idsOf(mails: readonly PlannedMail[]): { address: string; ids: string[] }[] {
	return mails.map(({ address, contacts }) => ({ address, ids: contacts.map(({ id }) => id) }));
}

describe(planMails, () => {
	it('merges a circular per address with members before partners, then by number, then by id', () => {
		const family = 'familie@example.org';
		const contacts = [
			contact({ customerNumber: 'K-2', email: family, id: 'p-numbered', kind: 'partner' }),
			contact({ email: family, id: 'p-b', kind: 'partner' }),
			contact({ email: 'Familie@Example.org ', id: 'm-200', kind: 'member', memberNumber: '200' }),
			contact({ email: family, id: 'p-a', kind: 'partner' }),
			contact({ email: family, id: 'm-100', kind: 'member', memberNumber: '100' }),
			// Another address, whose first contact comes before the family's first.
			contact({ email: 'solo@example.org', id: 'm-050', kind: 'member', memberNumber: '050' }),
		];
		expect(idsOf(planMails('circular', contacts))).toStrictEqual([
			{ address: 'solo@example.org', ids: ['m-050'] },
			{ address: family, ids: ['m-100', 'm-200', 'p-numbered', 'p-a', 'p-b'] },
		]);
	});

	it('never merges personal occasions', () => {
		const shared = 'familie@example.org';
		const contacts = [
			contact({ email: shared, id: 'm-2', kind: 'member', memberNumber: '2' }),
			contact({ email: shared, id: 'm-1', kind: 'member', memberNumber: '1' }),
			contact({ email: shared, id: 'p-1', kind: 'partner' }),
		];
		expect(idsOf(planMails('personal', contacts))).toStrictEqual([
			{ address: shared, ids: ['m-1'] },
			{ address: shared, ids: ['m-2'] },
			{ address: shared, ids: ['p-1'] },
		]);
	});

	it('plans no mail for a contact without an address', () => {
		const contacts = [
			contact({ email: null, id: 'm-1', kind: 'member', memberNumber: '1' }),
			contact({ email: ' ', id: 'm-2', kind: 'member', memberNumber: '2' }),
		];
		expect(planMails('personal', contacts)).toStrictEqual([]);
		expect(planMails('circular', contacts)).toStrictEqual([]);
	});
});
