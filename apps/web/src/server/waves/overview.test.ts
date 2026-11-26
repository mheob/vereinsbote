import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { recordBounce } from '@/server/bounces/bounces';
import { FAMILY, setUpSentWave, SINGLE } from '@/server/bounces/testing';
import { CONTACTS_PAGE_SIZE } from '@/server/contacts/list-query';
import { setFieldAreas } from '@/server/contacts/settings';
import { insertContact, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { contactBounces, contacts, outboxEntries } from '@/server/db/schema';
import { ForbiddenError } from '@/server/permissions/principal';
import type { EntryStatus } from '@/server/sending/outbox';
import { APP_ORIGIN } from '@/server/templates/testing';

import { WaveNotFoundError } from './errors';
import { bounceCount, listBounces, listEntries, listWaves, loadWave, waveState } from './overview';
import { stopWave } from './stop';
import { confirmTestWave, insertWave, setUpWaveClub, waveEntryIds } from './testing';
import type { WaveClub } from './testing';
import { confirmWave } from './waves';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');
/** An hour after `NOW`: the start of a planned wave. */
const LATER = new Date('2026-11-26T10:00:00.000Z');
/** A minute after `LATER`: the start of the planned wave has passed. */
const AFTER_START = new Date('2026-11-26T10:01:00.000Z');
/** When the provider reported the bounces. */
const REPORTED_AT = new Date('2026-11-26T09:30:00.000Z');
const MINUTE_MS = 60_000;

/**
 * A minute after the real clock: a wave confirmed for at once in a test was made by the database's
 * clock, so its start has passed by then.
 *
 * @returns The instant.
 */
function afterNow(): Date {
	return new Date(Date.now() + MINUTE_MS);
}

/** No entry in any state. */
const NO_ENTRIES: Readonly<Record<EntryStatus, number>> = {
	bounced: 0,
	cancelled: 0,
	failed: 0,
	planned: 0,
	sending: 0,
	sent: 0,
	skipped: 0,
	uncertain: 0,
};

/**
 * The counts of a wave: zero for every state not named.
 *
 * @param counts The states with entries.
 * @returns The counts of every state.
 */
function countsOf(
	counts: Readonly<Partial<Record<EntryStatus, number>>>,
): Record<EntryStatus, number> {
	return { ...NO_ENTRIES, ...counts };
}

/**
 * Sets columns of entries.
 *
 * @param db The database.
 * @param ids The entries.
 * @param values The columns.
 */
async function setEntries(
	db: Db,
	ids: readonly string[],
	values: Readonly<Partial<typeof outboxEntries.$inferInsert>>,
): Promise<void> {
	await db
		.update(outboxEntries)
		.set(values)
		.where(inArray(outboxEntries.id, [...ids]));
}

/**
 * Members with addresses of their own, numbered from 1.
 *
 * @param db The database.
 * @param count How many.
 */
async function insertMembers(db: Db, count: number): Promise<void> {
	for (let number = 1; number <= count; number += 1) {
		// oxlint-disable-next-line no-await-in-loop -- one after another, for a fixed order
		await insertContact(db, {
			email: `mitglied-${number}@example.org`,
			kind: 'member',
			memberNumber: String(number),
		});
	}
}

/**
 * Confirms a wave of the club's occasion for every member, planned for `LATER`.
 *
 * @param c The club.
 * @returns The id of the wave.
 * @throws {Error} When the confirmation made no wave.
 */
async function confirmPlannedWave(c: WaveClub): Promise<string> {
	const confirmed = await confirmWave(
		c.db,
		c.sender,
		{
			attachmentIds: [],
			notBefore: LATER,
			occasionId: c.occasionId,
			requestId: randomUUID(),
			selection: { contactIds: null, filters: {}, kind: 'member', query: '' },
		},
		APP_ORIGIN,
		NOW,
	);
	if (!('waveId' in confirmed)) throw new Error(`The test wave was refused: ${confirmed.refused}`);
	return confirmed.waveId;
}

describe(waveState, () => {
	it.each<{
		title: string;
		counts: Partial<Record<EntryStatus, number>>;
		notBefore: Date;
		taken: boolean;
		stopped: boolean;
		state: string;
	}>([
		{
			counts: { planned: 3 },
			notBefore: LATER,
			state: 'planned',
			stopped: false,
			taken: false,
			title: 'its start lies ahead and nothing was taken',
		},
		{
			counts: { planned: 3 },
			notBefore: NOW,
			state: 'running',
			stopped: false,
			taken: false,
			title: 'its start has passed and no run took an entry yet',
		},
		{
			counts: { planned: 2, sending: 1 },
			notBefore: LATER,
			state: 'running',
			stopped: false,
			taken: true,
			title: 'its start lies ahead but a run took an entry',
		},
		{
			counts: { planned: 3 },
			notBefore: NOW,
			state: 'running',
			stopped: false,
			taken: true,
			title: 'an entry waits for its retry',
		},
		{
			counts: { failed: 1, planned: 1, sent: 1 },
			notBefore: NOW,
			state: 'running',
			stopped: false,
			taken: true,
			title: 'some are sent, some failed, some wait',
		},
		{
			counts: { sent: 3 },
			notBefore: NOW,
			state: 'done',
			stopped: false,
			taken: true,
			title: 'every mail is sent',
		},
		{
			counts: { skipped: 3 },
			notBefore: NOW,
			state: 'done',
			stopped: false,
			taken: true,
			title: 'every entry was skipped',
		},
		{
			counts: { bounced: 1, uncertain: 1 },
			notBefore: NOW,
			state: 'done',
			stopped: false,
			taken: true,
			title: 'unclear and bounced entries wait for nobody',
		},
		{
			counts: { cancelled: 2 },
			notBefore: NOW,
			state: 'done',
			stopped: false,
			taken: true,
			title: 'every entry is cancelled without a stop',
		},
		{
			counts: {},
			notBefore: NOW,
			state: 'done',
			stopped: false,
			taken: false,
			title: 'the wave has no entry',
		},
		{
			counts: { cancelled: 3 },
			notBefore: LATER,
			state: 'stopped',
			stopped: true,
			taken: false,
			title: 'a planned wave was stopped',
		},
		{
			counts: { cancelled: 2, sending: 1 },
			notBefore: NOW,
			state: 'stopped',
			stopped: true,
			taken: true,
			title: 'a stop came while a mail was on its way',
		},
		{
			counts: { sent: 2 },
			notBefore: NOW,
			state: 'stopped',
			stopped: true,
			taken: true,
			title: 'a stopped wave had sent everything',
		},
	])('is $state when $title', ({ counts, notBefore, state, stopped, taken }) => {
		expect(waveState({ counts: countsOf(counts), notBefore, now: NOW, stopped, taken })).toBe(
			state,
		);
	});

	it('takes the start itself as passed', () => {
		const counts = countsOf({ planned: 1 });
		expect(waveState({ counts, notBefore: NOW, now: NOW, stopped: false, taken: false })).toBe(
			'running',
		);
	});
});

describe(listWaves, () => {
	it('lists waves of an area with counts per state for read users only', async () => {
		const c = await setUpWaveClub();
		await insertMembers(c.db, 3);
		const sentWave = await confirmTestWave(c, NOW);
		const [sentId = '', failedId = ''] = await waveEntryIds(c.db, sentWave);
		await setEntries(c.db, [sentId], { messageId: '<a@example.org>', status: 'sent' });
		await setEntries(c.db, [failedId], {
			lastErrorCode: 'graph.recipient',
			messageId: '<b@example.org>',
			status: 'failed',
		});
		const plannedWave = await confirmPlannedWave(c);
		const reader = await userWith(c.db, { [c.membersAreaId]: 'read' });
		const listed = await listWaves(c.db, reader, c.membersAreaId, 1, NOW);
		expect(listed).toStrictEqual({
			items: [
				{
					counts: countsOf({ planned: 3 }),
					id: plannedWave,
					notBefore: LATER,
					occasionName: 'Einladungen',
					state: 'planned',
				},
				{
					counts: countsOf({ failed: 1, planned: 1, sent: 1 }),
					id: sentWave,
					notBefore: expect.any(Date) as unknown,
					occasionName: 'Einladungen',
					state: 'running',
				},
			],
			total: 2,
		});
		const partnersReader = await userWith(c.db, { [c.partnersAreaId]: 'read' });
		const adminWithoutArea = await userWith(c.db, {}, { isAdmin: true });
		await expect(listWaves(c.db, partnersReader, c.membersAreaId, 1, NOW)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(listWaves(c.db, adminWithoutArea, c.membersAreaId, 1, NOW)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(listWaves(c.db, partnersReader, c.partnersAreaId, 1, NOW)).resolves.toStrictEqual({
			items: [],
			total: 0,
		});
	});

	it('pages the waves, newest first', async () => {
		const c = await setUpWaveClub();
		const ids: string[] = [];
		for (let index = 0; index <= CONTACTS_PAGE_SIZE; index += 1) {
			const createdAt = new Date(NOW.getTime() + index * MINUTE_MS);
			// oxlint-disable-next-line no-await-in-loop -- one after another, for their times
			ids.push(await insertWave(c.db, c.occasionId, { createdAt }));
		}
		const newestFirst = ids.toReversed();
		const first = await listWaves(c.db, c.sender, c.membersAreaId, 1, NOW);
		expect(first.total).toBe(CONTACTS_PAGE_SIZE + 1);
		expect(first.items.map(({ id }) => id)).toStrictEqual(newestFirst.slice(0, CONTACTS_PAGE_SIZE));
		const second = await listWaves(c.db, c.sender, c.membersAreaId, 2, NOW);
		expect(second.items.map(({ id }) => id)).toStrictEqual([ids[0]]);
		await expect(listWaves(c.db, c.sender, c.membersAreaId, 0, NOW)).rejects.toThrow(Error);
	});

	it('derives the wave state from entries, start and stop time', async () => {
		const c = await setUpWaveClub();
		await insertMembers(c.db, 2);
		const waveId = await confirmPlannedWave(c);
		const states: (string | undefined)[] = [];
		const record = async (now: Date): Promise<void> => {
			const { items } = await listWaves(c.db, c.sender, c.membersAreaId, 1, now);
			states.push(new Map(items.map(({ id, state }) => [id, state])).get(waveId));
		};
		// Its start lies ahead and no run took an entry; then its start has passed, no run came yet.
		await record(NOW);
		await record(AFTER_START);
		const [first = '', second = ''] = await waveEntryIds(c.db, waveId);
		// A run took the first entry, which waits for its retry: no longer planned.
		await setEntries(c.db, [first], { attempts: 1, messageId: '<a@example.org>' });
		await record(NOW);
		await setEntries(c.db, [first], { status: 'sent' });
		await setEntries(c.db, [second], { messageId: '<b@example.org>', status: 'uncertain' });
		await record(AFTER_START);
		await stopWave(c.db, c.sender, waveId);
		await record(AFTER_START);
		expect(states).toStrictEqual(['planned', 'running', 'running', 'done', 'stopped']);
		await expect(loadWave(c.db, c.sender, waveId, AFTER_START)).resolves.toMatchObject({
			areaName: 'Mitglieder',
			canSend: true,
			counts: countsOf({ sent: 1, uncertain: 1 }),
			id: waveId,
			occasionName: 'Einladungen',
			state: 'stopped',
		});
	});

	it('shows a wave sent at once as running before a run took an entry', async () => {
		const c = await setUpWaveClub();
		await insertMembers(c.db, 1);
		const waveId = await confirmTestWave(c, NOW);
		const { items } = await listWaves(c.db, c.sender, c.membersAreaId, 1, afterNow());
		expect(items).toMatchObject([{ id: waveId, state: 'running' }]);
	});
});

describe(loadWave, () => {
	it('needs read in the area of the wave and tells whether the user may send', async () => {
		const c = await setUpWaveClub();
		const waveId = await insertWave(c.db, c.occasionId);
		await expect(loadWave(c.db, c.editor, waveId, NOW)).resolves.toMatchObject({ canSend: false });
		const partnersReader = await userWith(c.db, { [c.partnersAreaId]: 'send' });
		await expect(loadWave(c.db, partnersReader, waveId, NOW)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(loadWave(c.db, c.sender, randomUUID(), NOW)).rejects.toBeInstanceOf(
			WaveNotFoundError,
		);
	});
});

describe(listEntries, () => {
	it('shows base fields of recipients and no mail content', async () => {
		const c = await setUpWaveClub();
		const anna = await insertContact(c.db, {
			birthDate: '1980-05-17',
			email: FAMILY,
			firstName: 'Anna',
			kind: 'member',
			lastName: 'Muster',
			memberNumber: '1',
		});
		const bernd = await insertContact(c.db, {
			email: FAMILY,
			firstName: 'Bernd',
			kind: 'member',
			lastName: 'Muster',
			memberNumber: '2',
		});
		const clara = await insertContact(c.db, {
			email: SINGLE,
			firstName: 'Clara',
			kind: 'member',
			lastName: 'Beispiel',
			memberNumber: '3',
		});
		const waveId = await confirmTestWave(c, NOW);
		const entryIds = await waveEntryIds(c.db, waveId);
		const reader = await userWith(c.db, { [c.membersAreaId]: 'read' });
		const before = await listEntries(c.db, reader, waveId, 1);
		const byContact = new Map(before.items.map(({ contactId, id }) => [contactId, id]));
		const single = byContact.get(clara);
		const family = byContact.get(anna);
		expect(new Set(entryIds)).toStrictEqual(new Set([single, family]));
		// A failed entry comes first; its mail went to the address the outbox recorded.
		await setEntries(
			c.db,
			entryIds.filter((id) => id === single),
			{
				lastErrorCode: 'missing:contact.lastName',
				messageId: '<c@example.org>',
				recipient: 'clara.neu@example.org',
				status: 'failed',
			},
		);
		const listed = await listEntries(c.db, reader, waveId, 1);
		expect(listed).toStrictEqual({
			items: [
				{
					code: 'missing:contact.lastName',
					contactId: clara,
					id: single,
					merged: 1,
					recipientEmail: 'clara.neu@example.org',
					recipientName: 'Clara Beispiel',
					status: 'failed',
				},
				{
					code: null,
					contactId: anna,
					id: family,
					merged: 2,
					recipientEmail: FAMILY,
					recipientName: 'Anna Muster',
					status: 'planned',
				},
			],
			total: 2,
		});
		// Nothing of the mail and no protected field reaches the page.
		expect(JSON.stringify(listed)).not.toMatch(/Sommerfest|1980|nr:/u);
		// A deleted contact gives way to the next of the address, then to a neutral name.
		await c.db.delete(contacts).where(eq(contacts.id, anna));
		const withoutAnna = await listEntries(c.db, reader, waveId, 1);
		expect(withoutAnna.items[1]).toMatchObject({ contactId: bernd, recipientName: 'Bernd Muster' });
		await c.db.delete(contacts).where(eq(contacts.id, bernd));
		const withoutFamily = await listEntries(c.db, reader, waveId, 1);
		expect(withoutFamily.items[1]).toMatchObject({
			contactId: null,
			merged: 2,
			recipientEmail: FAMILY,
			recipientName: null,
		});
	});

	it('needs read in the area of the wave', async () => {
		const c = await setUpWaveClub();
		await insertMembers(c.db, 1);
		const waveId = await confirmTestWave(c, NOW);
		const partnersReader = await userWith(c.db, { [c.partnersAreaId]: 'send' });
		const adminWithoutArea = await userWith(c.db, {}, { isAdmin: true });
		await expect(listEntries(c.db, partnersReader, waveId, 1)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(listEntries(c.db, adminWithoutArea, waveId, 1)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(listEntries(c.db, c.sender, randomUUID(), 1)).rejects.toBeInstanceOf(
			WaveNotFoundError,
		);
		await expect(listEntries(c.db, c.editor, waveId, 1)).resolves.toMatchObject({ total: 1 });
	});

	it('shows a reached exit as unavailable to a user who may not see exit dates', async () => {
		const c = await setUpWaveClub();
		await insertMembers(c.db, 2);
		const waveId = await confirmTestWave(c, NOW);
		const [exited = '', missing = ''] = await waveEntryIds(c.db, waveId);
		await setEntries(c.db, [exited], { lastErrorCode: 'exited', status: 'skipped' });
		await setEntries(c.db, [missing], { lastErrorCode: 'missing:contact.city', status: 'failed' });
		const codes = async (): Promise<(string | null | undefined)[]> => {
			const { items } = await listEntries(c.db, c.sender, waveId, 1);
			const byId = new Map(items.map(({ code, id }) => [id, code]));
			return [byId.get(exited), byId.get(missing)];
		};
		await expect(codes()).resolves.toStrictEqual(['exited', 'missing:contact.city']);
		await setFieldAreas(c.db, c.admin, {
			areaIds: [c.partnersAreaId],
			fieldKey: 'exitDate',
			kind: 'member',
		});
		await expect(codes()).resolves.toStrictEqual(['unavailable', 'missing:contact.city']);
	});
});

describe('the bounce marks of the overview', () => {
	it('counts bounces for the navigation per visible area', async () => {
		const sent = await setUpSentWave();
		const { db, membersAreaId, partnersAreaId } = sent.club;
		await recordBounce(db, {
			at: REPORTED_AT,
			entry: { messageId: sent.family.messageId },
			hard: true,
			source: 'graph',
		});
		await recordBounce(db, {
			at: REPORTED_AT,
			entry: { messageId: sent.single.messageId },
			hard: true,
			source: 'graph',
		});
		// Member 3 has another address now: the mark no longer applies.
		await db
			.update(contacts)
			.set({ email: 'clara.neu@example.org' })
			.where(eq(contacts.id, sent.contactIds[3]));
		// A mark without an entry: the area of the partners decides.
		await insertContact(db, {
			customerNumber: 'K-1',
			email: 'firma@example.org',
			kind: 'partner',
			organization: 'Firma GmbH',
		});
		await db.insert(contactBounces).values({
			contactKey: 'nr:K-1',
			createdAt: REPORTED_AT,
			email: 'firma@example.org',
			kind: 'partner',
			source: 'resend',
		});
		const membersReader = await userWith(db, { [membersAreaId]: 'read' });
		const partnersReader = await userWith(db, { [partnersAreaId]: 'read' });
		const both = await userWith(db, { [membersAreaId]: 'send', [partnersAreaId]: 'read' });
		const adminWithoutArea = await userWith(db, {}, { isAdmin: true });
		const counts = await Promise.all(
			[membersReader, partnersReader, both, adminWithoutArea].map(async (principal) =>
				bounceCount(db, principal),
			),
		);
		expect(counts).toStrictEqual([2, 1, 3, 0]);
	});

	it('lists the marks of an area with the base fields of their contacts', async () => {
		const sent = await setUpSentWave();
		const { db, membersAreaId, partnersAreaId } = sent.club;
		await recordBounce(db, {
			at: REPORTED_AT,
			entry: { messageId: sent.family.messageId },
			hard: true,
			source: 'graph',
		});
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		await expect(listBounces(db, reader, membersAreaId)).resolves.toStrictEqual([
			{ at: REPORTED_AT, contactId: sent.contactIds[1], email: FAMILY, name: 'Vorname-1' },
			{ at: REPORTED_AT, contactId: sent.contactIds[2], email: FAMILY, name: 'Vorname-2' },
		]);
		const partnersReader = await userWith(db, { [partnersAreaId]: 'read' });
		await expect(listBounces(db, partnersReader, partnersAreaId)).resolves.toStrictEqual([]);
		await expect(listBounces(db, partnersReader, membersAreaId)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});
});
