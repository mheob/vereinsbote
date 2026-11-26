import { describe, expect, it } from 'vite-plus/test';

import { insertContact } from '@/server/contacts/testing';
import { ForbiddenError } from '@/server/permissions/principal';

import { MAX_RECIPIENT_CHOICES, searchRecipients } from './recipient-search';
import type { RecipientSelection } from './recipients';
import { setUpWaveClub } from './testing';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');

const EVERY_MEMBER: RecipientSelection = {
	contactIds: null,
	filters: {},
	kind: 'member',
	query: '',
};

describe(searchRecipients, () => {
	it('finds contacts of the selection by the term, with base fields only', async () => {
		const c = await setUpWaveClub();
		const anna = await insertContact(c.db, {
			birthDate: '1990-05-01',
			email: 'anna@example.org',
			firstName: 'Anna',
			kind: 'member',
			lastName: 'Muster',
		});
		await insertContact(c.db, { email: 'bernd@example.org', firstName: 'Bernd', kind: 'member' });
		await insertContact(c.db, { email: 'anna-firma@example.org', kind: 'partner' });
		const found = await searchRecipients(
			c.db,
			c.sender,
			{ occasionId: c.occasionId, selection: EVERY_MEMBER, term: 'anna' },
			NOW,
		);
		expect(found).toStrictEqual([
			{ email: 'anna@example.org', id: anna, kind: 'member', name: 'Anna Muster' },
		]);
	});

	it('searches only within the contacts a selection one by one names', async () => {
		const c = await setUpWaveClub();
		const anna = await insertContact(c.db, { firstName: 'Anna', kind: 'member' });
		await insertContact(c.db, { firstName: 'Anne', kind: 'member' });
		const chosen = { ...EVERY_MEMBER, contactIds: [anna], kind: 'both' } as const;
		const input = { occasionId: c.occasionId, selection: chosen, term: 'ann' };
		await expect(searchRecipients(c.db, c.sender, input, NOW)).resolves.toMatchObject([
			{ id: anna },
		]);
		const none = { ...input, selection: { ...chosen, contactIds: [] } };
		await expect(searchRecipients(c.db, c.sender, none, NOW)).resolves.toStrictEqual([]);
	});

	it('gives at most ten contacts, by name', async () => {
		const c = await setUpWaveClub();
		for (const name of [
			'Zora',
			'Anton',
			'Mia',
			'Ben',
			'Lea',
			'Tim',
			'Eva',
			'Paul',
			'Ida',
			'Ole',
			'Uwe',
		]) {
			// oxlint-disable-next-line no-await-in-loop -- a handful of contacts, one after another
			await insertContact(c.db, { firstName: name, kind: 'member' });
		}
		const found = await searchRecipients(
			c.db,
			c.sender,
			{ occasionId: c.occasionId, selection: EVERY_MEMBER, term: '' },
			NOW,
		);
		expect(found).toHaveLength(MAX_RECIPIENT_CHOICES);
		expect(found.map(({ name }) => name).slice(0, 3)).toStrictEqual(['Anton', 'Ben', 'Eva']);
	});

	it('needs send in the area of the occasion', async () => {
		const c = await setUpWaveClub();
		const input = { occasionId: c.occasionId, selection: EVERY_MEMBER, term: '' };
		await expect(searchRecipients(c.db, c.editor, input, NOW)).rejects.toThrow(ForbiddenError);
		await expect(searchRecipients(c.db, c.admin, input, NOW)).rejects.toThrow(ForbiddenError);
	});
});
