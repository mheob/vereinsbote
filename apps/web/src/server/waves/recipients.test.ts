import { describe, expect, it } from 'vite-plus/test';

import { compareCodePoints } from '@/server/compare-code-points';
import { insertContact, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import {
	contactBounces,
	contactOptOuts,
	contactSuppressions,
	protectedFieldAreas,
} from '@/server/db/schema';
import { getOccasion } from '@/server/occasions/occasions';
import type { OccasionRecord } from '@/server/occasions/occasions';
import { ForbiddenError } from '@/server/permissions/principal';

import { resolveRecipients } from './recipients';
import type { ExclusionReason, RecipientSelection } from './recipients';
import { setUpWaveClub } from './testing';
import type { WaveClub } from './testing';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');

const EVERY_MEMBER: RecipientSelection = {
	contactIds: null,
	filters: {},
	kind: 'member',
	query: '',
};

const NO_EXCLUSION: Record<ExclusionReason, number> = {
	exited: 0,
	invalidEmail: 0,
	noEmail: 0,
	optedOutArea: 0,
	optedOutOccasion: 0,
	suppressed: 0,
};

/**
 * The occasion of the club.
 *
 * @param c The club.
 * @returns The occasion.
 */
async function occasionOf(c: WaveClub): Promise<OccasionRecord> {
	return getOccasion(c.db, c.sender, c.occasionId);
}

/**
 * A member with an address.
 *
 * @param db The database.
 * @param memberNumber The member number; the address is made from it.
 * @param values Further columns.
 * @returns The id.
 */
async function member(
	db: Db,
	memberNumber: string,
	values: Readonly<{
		email?: string | null;
		exitDate?: string;
		city?: string;
		groups?: readonly string[];
	}> = {},
): Promise<string> {
	return insertContact(db, {
		email: `mitglied-${memberNumber}@example.org`,
		kind: 'member',
		memberNumber,
		...values,
		groups: [...(values.groups ?? [])],
	});
}

/**
 * Makes the member with the number unmailable for a reason.
 *
 * @param c The club.
 * @param reason The reason.
 * @param memberNumber The member's number.
 */
async function exclude(c: WaveClub, reason: ExclusionReason, memberNumber: string): Promise<void> {
	const contactKey = `nr:${memberNumber}`;
	const email = `mitglied-${memberNumber}@example.org`;
	const kind = 'member';
	const make: Record<ExclusionReason, () => Promise<unknown>> = {
		exited: async () => member(c.db, memberNumber, { exitDate: '2026-11-26' }),
		invalidEmail: async () => {
			await member(c.db, memberNumber);
			await c.db.insert(contactBounces).values({ contactKey, email, kind, source: 'graph' });
		},
		noEmail: async () => member(c.db, memberNumber, { email: null }),
		optedOutArea: async () => {
			await member(c.db, memberNumber);
			const areaId = c.membersAreaId;
			await c.db.insert(contactOptOuts).values({ areaId, contactKey, kind, scope: 'area' });
		},
		optedOutOccasion: async () => {
			await member(c.db, memberNumber);
			const { occasionId } = c;
			await c.db.insert(contactOptOuts).values({ contactKey, kind, occasionId, scope: 'occasion' });
		},
		suppressed: async () => {
			await member(c.db, memberNumber);
			await c.db.insert(contactSuppressions).values({ contactKey, kind });
		},
	};
	await make[reason]();
}

/**
 * The member numbers of the mailable contacts.
 *
 * @param resolved What `resolveRecipients` gave.
 * @param resolved.mailable The mailable contacts.
 * @returns Their numbers, sorted.
 */
function numbersOf(
	resolved: Readonly<{ mailable: readonly Readonly<{ memberNumber: string | null }>[] }>,
): (string | null)[] {
	return resolved.mailable
		.map(({ memberNumber }) => memberNumber)
		.toSorted((a, b) => compareCodePoints(a ?? '', b ?? ''));
}

describe(resolveRecipients, () => {
	it.each([
		'suppressed',
		'exited',
		'noEmail',
		'invalidEmail',
		'optedOutOccasion',
		'optedOutArea',
	] as const)('counts %s as excluded', async (reason) => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		await exclude(c, reason, '2');
		const resolved = await resolveRecipients(
			c.db,
			c.sender,
			await occasionOf(c),
			EVERY_MEMBER,
			NOW,
		);
		expect(numbersOf(resolved)).toStrictEqual(['1']);
		expect(resolved.excluded).toStrictEqual({ ...NO_EXCLUSION, [reason]: 1 });
	});

	it('ignores opt-outs of other occasions and areas, and a mark of an old address', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const contactKey = 'nr:1';
		const kind = 'member';
		await c.db
			.insert(contactOptOuts)
			.values({ areaId: c.partnersAreaId, contactKey, kind, scope: 'area' });
		await c.db
			.insert(contactBounces)
			.values({ contactKey, email: 'alt@example.org', kind, source: 'resend' });
		const resolved = await resolveRecipients(
			c.db,
			c.sender,
			await occasionOf(c),
			EVERY_MEMBER,
			NOW,
		);
		expect(numbersOf(resolved)).toStrictEqual(['1']);
		expect(resolved.excluded).toStrictEqual(NO_EXCLUSION);
	});

	it('counts a contact once, under its first reason', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1', { email: null, exitDate: '2020-01-01' });
		await c.db.insert(contactSuppressions).values({ contactKey: 'nr:1', kind: 'member' });
		const resolved = await resolveRecipients(
			c.db,
			c.sender,
			await occasionOf(c),
			EVERY_MEMBER,
			NOW,
		);
		expect(resolved.excluded).toStrictEqual({ ...NO_EXCLUSION, suppressed: 1 });
	});

	it('selects by kind, group, search and single selection like the contact list', async () => {
		const c = await setUpWaveClub();
		const anna = await member(c.db, '1', { groups: ['Vorstand'] });
		await member(c.db, '2', { groups: ['Jugend'] });
		const bert = await insertContact(c.db, {
			email: 'bert@example.org',
			kind: 'member',
			lastName: 'Bertrand',
			memberNumber: '3',
		});
		const partner = await insertContact(c.db, {
			email: 'firma@example.org',
			kind: 'partner',
			tags: ['Sponsor'],
		});
		const occasion = await occasionOf(c);
		const select = async (selection: Readonly<Partial<RecipientSelection>>): Promise<string[]> => {
			const resolved = await resolveRecipients(
				c.db,
				c.sender,
				occasion,
				{ ...EVERY_MEMBER, ...selection },
				NOW,
			);
			return resolved.mailable.map(({ id }) => id).toSorted(compareCodePoints);
		};
		await expect(select({ filters: { group: 'Vorstand' } })).resolves.toStrictEqual([anna]);
		await expect(select({ query: 'bertr' })).resolves.toStrictEqual([bert]);
		await expect(select({ filters: { tag: 'sponsor' }, kind: 'partner' })).resolves.toStrictEqual([
			partner,
		]);
		await expect(select({ kind: 'both' })).resolves.toHaveLength(4);
	});

	it('narrows the filters with a single selection, never widens them', async () => {
		const c = await setUpWaveClub();
		const anna = await member(c.db, '1', { groups: ['Vorstand'] });
		const bert = await member(c.db, '2', { groups: ['Vorstand'] });
		await member(c.db, '3', { groups: ['Jugend'] });
		const partner = await insertContact(c.db, { email: 'firma@example.org', kind: 'partner' });
		const occasion = await occasionOf(c);
		const select = async (contactIds: readonly string[]): Promise<string[]> => {
			const selection = { ...EVERY_MEMBER, contactIds, filters: { group: 'Vorstand' } };
			const resolved = await resolveRecipients(c.db, c.sender, occasion, selection, NOW);
			return resolved.mailable.map(({ id }) => id).toSorted(compareCodePoints);
		};
		await expect(select([anna, partner])).resolves.toStrictEqual([anna]);
		await expect(select([anna, bert])).resolves.toStrictEqual(
			[anna, bert].toSorted(compareCodePoints),
		);
		await expect(select([])).resolves.toStrictEqual([]);
	});

	it('filters protected fields only for users who see them', async () => {
		// A filter on a protected field needs the right to see it (sub-plan 2). The selection takes
		// the filters of the contact list (plan decision 15: kind, group, tag and the search over
		// base fields), none of them on a protected field: a protected value (here the city) selects
		// nobody, so a user who does not see the address cannot find out who lives where.
		const c = await setUpWaveClub();
		await member(c.db, '1', { city: 'Musterstadt' });
		// Only "Finanzen" sees the members' address: the sender of "Mitglieder" does not.
		await c.db
			.insert(protectedFieldAreas)
			.values({ areaId: c.partnersAreaId, fieldKey: 'address', kind: 'member' });
		const occasion = await occasionOf(c);
		const byCity = { ...EVERY_MEMBER, query: 'Musterstadt' };
		await expect(resolveRecipients(c.db, c.sender, occasion, byCity, NOW)).resolves.toMatchObject({
			mailable: [],
		});
		const seesAddress = await userWith(c.db, {
			[c.membersAreaId]: 'send',
			[c.partnersAreaId]: 'read',
		});
		await expect(
			resolveRecipients(c.db, seesAddress, occasion, byCity, NOW),
		).resolves.toMatchObject({ mailable: [] });
		await expect(
			resolveRecipients(c.db, c.sender, occasion, EVERY_MEMBER, NOW),
		).resolves.toMatchObject({ mailable: [{ city: 'Musterstadt' }] });
	});

	it('needs send in the area of the occasion', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const occasion = await occasionOf(c);
		await expect(resolveRecipients(c.db, c.editor, occasion, EVERY_MEMBER, NOW)).rejects.toThrow(
			ForbiddenError,
		);
	});
});
