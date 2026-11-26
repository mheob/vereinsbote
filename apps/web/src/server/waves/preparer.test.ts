import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { emptyTemplate } from '@/mail/starters/starters';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { attachmentStorageKey, storeAttachment } from '@/server/attachments/attachments';
import { pdfBytes } from '@/server/attachments/testing';
import { insertContact } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import {
	contactBounces,
	contactOptOuts,
	contacts,
	contactSuppressions,
	outboxEntries,
	waveContacts,
} from '@/server/db/schema';
import { createOccasion } from '@/server/occasions/occasions';
import type {
	ClaimedEntry,
	PrepareContext,
	PrepareEntry,
	PreparedMail,
} from '@/server/sending/outbox';
import { senderOn, testEnv } from '@/server/sending/testing';
import type { OutgoingMail } from '@/server/sending/transport';
import { createMemoryStorage } from '@/server/storage/memory';
import type { ObjectStorage } from '@/server/storage/storage';
import { deriveUnsubscribeKey, openUnsubscribe } from '@/server/unsubscribe/token';
import type { UnsubscribePayload } from '@/server/unsubscribe/token';

import { wavePreparer } from './preparer';
import { confirmTestWave, setUpWaveClub, waveEntryIds } from './testing';
import type { WaveClub } from './testing';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');
const FAMILY = 'familie@example.org';

/**
 * A template whose heading holds a placeholder without fallback.
 *
 * @param key The placeholder key.
 * @returns The template.
 */
function templateWith(key: string): TemplateInput {
	return {
		...emptyTemplate({ name: 'Einladung', subject: 'Sommerfest' }),
		body: {
			blocks: [
				{
					content: [
						{ text: 'Hallo ', type: 'text' },
						{ attrs: { fallback: null, key }, type: 'placeholder' },
					],
					id: 'heading',
					level: 2,
					type: 'heading',
				},
			],
			kind: 'blocks',
			layout: { kind: 'standard' },
		},
	};
}

/**
 * A member with a first name; its address is made from the number unless given.
 *
 * @param db The database.
 * @param memberNumber The member number.
 * @param email The address.
 * @returns The id.
 */
async function member(db: Db, memberNumber: string, email?: string): Promise<string> {
	return insertContact(db, {
		email: email ?? `mitglied-${memberNumber}@example.org`,
		firstName: `Vorname-${memberNumber}`,
		kind: 'member',
		memberNumber,
	});
}

/**
 * Members at one address, one after the other.
 *
 * @param db The database.
 * @param numbers Their member numbers.
 * @param email The address.
 * @returns The id of the first.
 */
async function membersAt(db: Db, numbers: readonly string[], email: string): Promise<string> {
	const ids: string[] = [];
	for (const number of numbers) {
		// oxlint-disable-next-line no-await-in-loop -- the contacts keep their order
		ids.push(await member(db, number, email));
	}
	const [first] = ids;
	if (first === undefined) throw new Error('No member was made.');
	return first;
}

/**
 * The unsubscribe link in the HTML of a mail.
 *
 * @param html The HTML.
 * @returns The link.
 */
function htmlLink(html: string): string {
	const link = /href="(?<link>https:\/\/bote\.example\.org\/unsubscribe\/[\w-]+)"/u.exec(html)
		?.groups?.link;
	if (link === undefined) throw new Error('The mail has no unsubscribe link.');
	return link;
}

/**
 * The outbox entry that holds a contact, as the outbox hands it to the preparer.
 *
 * @param db The database.
 * @param contactId The contact.
 * @returns The entry with a Message-ID of its own.
 */
async function entryOf(db: Db, contactId: string): Promise<ClaimedEntry> {
	const [row] = await db
		.select({
			attempts: outboxEntries.attempts,
			id: outboxEntries.id,
			priority: outboxEntries.priority,
			senderId: outboxEntries.senderId,
			sourceId: outboxEntries.sourceId,
		})
		.from(outboxEntries)
		.innerJoin(waveContacts, eq(waveContacts.entryId, outboxEntries.id))
		.where(eq(waveContacts.contactId, contactId));
	if (row === undefined) throw new Error('No entry holds the contact.');
	return {
		...row,
		firstAttemptAt: null,
		messageId: `<${row.id}@example.org>`,
		senderId: row.senderId ?? '',
		source: 'wave',
	};
}

/**
 * What the preparer makes of the entry that holds a contact.
 *
 * @param c The club.
 * @param contactId The contact.
 * @param ctx What differs from a call at `NOW` without storage.
 * @param prepare The prepare function: a run's, or the preparer's own.
 * @returns The prepared mail, skip or failure.
 */
// oxlint-disable-next-line max-params -- the club, the contact, the context and the function
async function prepareFor(
	c: WaveClub,
	contactId: string,
	ctx: Partial<PrepareContext> = {},
	prepare: PrepareEntry = wavePreparer.prepare,
): Promise<PreparedMail> {
	return prepare(c.db, await entryOf(c.db, contactId), {
		env: testEnv(),
		now: NOW,
		storage: null,
		...ctx,
	});
}

/**
 * The prepare function of a run of the outbox.
 *
 * @returns The function the preparer starts for a run.
 * @throws {Error} When the preparer keeps nothing for a run.
 */
function startRun(): PrepareEntry {
	const start = wavePreparer.startRun;
	if (start === undefined) throw new Error('The wave preparer starts no run.');
	return start();
}

/**
 * The unsubscribe link of a mail.
 *
 * @param mail The mail.
 * @returns The link of its header.
 * @throws {Error} When it has none.
 */
function linkOf(mail: Readonly<OutgoingMail>): string {
	if (mail.listUnsubscribe === null) throw new Error('The mail has no unsubscribe link.');
	return mail.listUnsubscribe;
}

/**
 * A storage that records the keys read from it.
 *
 * @param storage The storage.
 * @returns The recording storage and the keys it read, in order.
 */
function countingReads(storage: ObjectStorage): {
	storage: ObjectStorage;
	reads: () => readonly string[];
} {
	const reads: string[] = [];
	return {
		reads: () => reads,
		storage: {
			...storage,
			async get(key) {
				reads.push(key);
				return storage.get(key);
			},
		},
	};
}

/**
 * The entries of a wave as the outbox hands them to the preparer, ordered by id.
 *
 * @param db The database.
 * @param waveId The wave.
 * @returns The entries.
 */
async function entriesOfWave(db: Db, waveId: string): Promise<ClaimedEntry[]> {
	const ids = await waveEntryIds(db, waveId);
	const rows = await db
		.select({ id: outboxEntries.id, senderId: outboxEntries.senderId })
		.from(outboxEntries)
		.where(eq(outboxEntries.waveId, waveId));
	return ids.map((id) => ({
		attempts: 0,
		firstAttemptAt: null,
		id,
		messageId: `<${id}@example.org>`,
		priority: 'group',
		senderId: rows.find((row) => row.id === id)?.senderId ?? '',
		source: 'wave',
		sourceId: waveId,
	}));
}

/**
 * A second occasion of the club's area with a sender of its own on the same connection.
 *
 * @param c The club.
 * @returns The occasion.
 */
async function secondOccasion(c: WaveClub): Promise<string> {
	const senderId = await senderOn(c.db, c.admin, c.connectionId, 'vorstand@example.org', [
		c.membersAreaId,
	]);
	const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, {
		kind: 'circular',
		name: 'Rundbriefe',
		senderId,
		templateId: c.templateId,
		unsubscribe: true,
	});
	return id;
}

/**
 * The mail of a prepared send.
 *
 * @param prepared What the preparer made.
 * @returns The mail and its recipient.
 * @throws {Error} When the preparer made no mail.
 */
function sent(prepared: Readonly<PreparedMail>): { mail: OutgoingMail; recipient: string } {
	if (prepared.kind !== 'send') throw new Error(`No mail: ${JSON.stringify(prepared)}`);
	return { mail: prepared.mail, recipient: prepared.recipient };
}

/**
 * Opens the token of an unsubscribe link with the key of the test environment.
 *
 * @param link The link.
 * @returns What the token names.
 */
async function payloadOf(link: string | null): Promise<UnsubscribePayload | null> {
	const token = link?.slice(link.lastIndexOf('/') + 1) ?? '';
	return openUnsubscribe(await deriveUnsubscribeKey(testEnv().appSecret), token);
}

/**
 * The payload of the club's occasion for members.
 *
 * @param c The club.
 * @param numbers The member numbers.
 * @returns The payload.
 */
function membersPayload(c: WaveClub, numbers: readonly string[]): UnsubscribePayload {
	return {
		areaId: c.membersAreaId,
		contacts: numbers.map((number) => ({ key: `nr:${number}`, kind: 'member' })),
		occasionId: c.occasionId,
	};
}

type Exclusion =
	| 'deleted'
	| 'invalidEmail'
	| 'noEmail'
	| 'optedOutArea'
	| 'optedOutOccasion'
	| 'suppressed';

/**
 * Makes a confirmed member unmailable for a reason.
 *
 * @param c The club.
 * @param id The member.
 * @param memberNumber Its number.
 * @param reason The reason.
 */
// oxlint-disable-next-line max-params -- the club, the contact, its number and the reason
async function exclude(
	c: WaveClub,
	id: string,
	memberNumber: string,
	reason: Exclusion,
): Promise<void> {
	const contactKey = `nr:${memberNumber}`;
	const kind = 'member';
	const make: Record<Exclusion, () => Promise<unknown>> = {
		deleted: async () => c.db.delete(contacts).where(eq(contacts.id, id)),
		invalidEmail: async () =>
			c.db.insert(contactBounces).values({
				contactKey,
				email: `mitglied-${memberNumber}@example.org`,
				kind,
				source: 'graph',
			}),
		noEmail: async () => c.db.update(contacts).set({ email: null }).where(eq(contacts.id, id)),
		optedOutArea: async () =>
			c.db
				.insert(contactOptOuts)
				.values({ areaId: c.membersAreaId, contactKey, kind, scope: 'area' }),
		optedOutOccasion: async () =>
			c.db
				.insert(contactOptOuts)
				.values({ contactKey, kind, occasionId: c.occasionId, scope: 'occasion' }),
		suppressed: async () => c.db.insert(contactSuppressions).values({ contactKey, kind }),
	};
	await make[reason]();
}

/**
 * Prepares entries one after another with the prepare function of one run.
 *
 * @param c The club.
 * @param prepare The run's prepare function.
 * @param entries The entries, in the order the lanes take turns.
 * @param storage The storage.
 * @returns The file names of each mail.
 */
// oxlint-disable-next-line max-params -- the club, the function, the entries and the storage
async function filesInTurn(
	c: WaveClub,
	prepare: PrepareEntry,
	entries: readonly ClaimedEntry[],
	storage: ObjectStorage,
): Promise<string[][]> {
	const files: string[][] = [];
	for (const entry of entries) {
		// oxlint-disable-next-line no-await-in-loop -- the lanes take turns, one mail after another
		const prepared = await prepare(c.db, entry, { env: testEnv(), now: NOW, storage });
		files.push(sent(prepared).mail.attachments.map(({ filename }) => filename));
	}
	return files;
}

/**
 * The entries of two lanes in the order their turns come: one of each, then the next.
 *
 * @param first The entries of one lane.
 * @param second The entries of the other.
 * @returns The entries in turn.
 */
function takingTurns(
	first: readonly ClaimedEntry[],
	second: readonly ClaimedEntry[],
): ClaimedEntry[] {
	const turns: ClaimedEntry[] = [];
	for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
		turns.push(...first.slice(index, index + 1), ...second.slice(index, index + 1));
	}
	return turns;
}

describe('the wave preparer', () => {
	it('skips a contact whose exit date has come since the confirmation', async () => {
		const c = await setUpWaveClub({ kind: 'personal' });
		const id = await member(c.db, '1');
		await confirmTestWave(c, NOW);
		// 00:30 on 27 November in Berlin, still the 26th in UTC.
		const lateAtNight = new Date('2026-11-26T23:30:00.000Z');
		await c.db.update(contacts).set({ exitDate: '2026-11-27' }).where(eq(contacts.id, id));
		await expect(prepareFor(c, id, { now: NOW })).resolves.toMatchObject({ kind: 'send' });
		await expect(prepareFor(c, id, { now: lateAtNight })).resolves.toStrictEqual({
			kind: 'skip',
			reason: 'exited',
		});
	});

	it.each([
		'suppressed',
		'optedOutOccasion',
		'optedOutArea',
		'invalidEmail',
		'noEmail',
		'deleted',
	] as const)('skips suppressed, opted-out, invalid and deleted contacts: %s', async (reason) => {
		const c = await setUpWaveClub();
		const id = await member(c.db, '1');
		await confirmTestWave(c, NOW);
		const entry = await entryOf(c.db, id);
		await exclude(c, id, '1', reason);
		await expect(
			wavePreparer.prepare(c.db, entry, { env: testEnv(), now: NOW, storage: null }),
		).resolves.toStrictEqual({ kind: 'skip', reason });
	});

	it('lets the next contact of a merged address move up', async () => {
		const c = await setUpWaveClub({ template: templateWith('contact.firstName') });
		const first = await member(c.db, '1', FAMILY);
		const second = await member(c.db, '2', FAMILY);
		await confirmTestWave(c, NOW);
		await exclude(c, first, '1', 'optedOutOccasion');
		const { mail, recipient } = sent(await prepareFor(c, first));
		expect({ recipient, to: mail.to }).toStrictEqual({ recipient: FAMILY, to: FAMILY });
		expect(mail.html).toContain('Hallo Vorname-2');
		await expect(payloadOf(mail.listUnsubscribe)).resolves.toStrictEqual(membersPayload(c, ['2']));
		await exclude(c, second, '2', 'suppressed');
		await expect(prepareFor(c, first)).resolves.toStrictEqual({
			kind: 'skip',
			reason: 'optedOutOccasion',
		});
	});

	it('sends a personal mail to the new address after an import', async () => {
		const c = await setUpWaveClub({ kind: 'personal' });
		const id = await member(c.db, '1');
		await confirmTestWave(c, NOW);
		await c.db.update(contacts).set({ email: 'neu-1@example.org' }).where(eq(contacts.id, id));
		const { mail, recipient } = sent(await prepareFor(c, id));
		expect(recipient).toBe('neu-1@example.org');
		expect(mail).toMatchObject({ listUnsubscribe: null, to: 'neu-1@example.org' });
	});

	it('drops a contact with a new address from a circular entry', async () => {
		const c = await setUpWaveClub({ template: templateWith('contact.firstName') });
		const first = await member(c.db, '1', FAMILY);
		await member(c.db, '2', FAMILY);
		const solo = await member(c.db, '3');
		await confirmTestWave(c, NOW);
		const moved = { email: 'neu@example.org' };
		await c.db.update(contacts).set(moved).where(eq(contacts.id, first));
		await c.db.update(contacts).set(moved).where(eq(contacts.id, solo));
		const { mail, recipient } = sent(await prepareFor(c, first));
		expect(recipient).toBe(FAMILY);
		expect(mail.html).toContain('Hallo Vorname-2');
		await expect(payloadOf(mail.listUnsubscribe)).resolves.toStrictEqual(membersPayload(c, ['2']));
		await expect(prepareFor(c, solo)).resolves.toStrictEqual({
			kind: 'skip',
			reason: 'addressChanged',
		});
	});

	it('fails an entry with a missing required value and names only the key', async () => {
		const c = await setUpWaveClub({ template: templateWith('contact.lastName') });
		const id = await member(c.db, '1');
		await confirmTestWave(c, NOW);
		await expect(prepareFor(c, id)).resolves.toStrictEqual({
			code: 'missing:contact.lastName',
			kind: 'fail',
		});
	});

	it('fills current values and puts every merged contact into the unsubscribe link', async () => {
		const c = await setUpWaveClub({ template: templateWith('contact.firstName') });
		const first = await member(c.db, '1', FAMILY);
		await member(c.db, '2', FAMILY);
		await confirmTestWave(c, NOW);
		await c.db.update(contacts).set({ firstName: 'Erika' }).where(eq(contacts.id, first));
		const { mail } = sent(await prepareFor(c, first));
		const link = linkOf(mail);
		expect(mail).toMatchObject({
			bcc: null,
			from: { address: 'verein@example.org', name: 'Verein' },
			kind: 'regular',
			replyTo: null,
			subject: 'Sommerfest',
		});
		expect(mail.html).toContain('Hallo Erika');
		expect(link).toMatch(/^https:\/\/bote\.example\.org\/unsubscribe\/[\w-]+$/u);
		expect([mail.html, mail.text]).toStrictEqual([
			expect.stringContaining(`href="${link}"`),
			expect.stringContaining(link),
		]);
		await expect(payloadOf(link)).resolves.toStrictEqual(membersPayload(c, ['1', '2']));
	});

	it('leaves out the unsubscribe headers above 998 characters and keeps the link in the mail', async () => {
		const c = await setUpWaveClub();
		const numbers = Array.from({ length: 14 }, (_unused, index) =>
			String(index + 1).padStart(40, '0'),
		);
		const first = await membersAt(c.db, numbers, FAMILY);
		await confirmTestWave(c, NOW);
		const { mail } = sent(await prepareFor(c, first));
		expect(mail.listUnsubscribe).toBeNull();
		const link = htmlLink(mail.html);
		expect(`List-Unsubscribe: <${link}>`.length).toBeGreaterThan(998);
		expect(mail.text).toContain(link);
		await expect(payloadOf(link)).resolves.toStrictEqual(membersPayload(c, numbers));
	});

	it('prepares the same mail again for a retry', async () => {
		const c = await setUpWaveClub({ template: templateWith('contact.firstName') });
		const first = await member(c.db, '1', FAMILY);
		await member(c.db, '2', FAMILY);
		await confirmTestWave(c, NOW);
		const once = sent(await prepareFor(c, first));
		await expect(prepareFor(c, first)).resolves.toStrictEqual({ kind: 'send', ...once });
	});

	it('attaches the files of the wave and sets the idempotency key', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		const first = await member(c.db, '1');
		const second = await member(c.db, '2');
		const memory = createMemoryStorage();
		const bytes = pdfBytes(2000);
		const flyer = await storeAttachment(c.db, memory, c.sender, c.occasionId, {
			bytes,
			name: 'flyer.pdf',
		});
		await confirmTestWave(c, NOW, [flyer.id]);
		const { reads, storage } = countingReads(memory);
		const run = startRun();
		const entry = await entryOf(c.db, first);
		const { mail } = sent(await prepareFor(c, first, { storage }, run));
		expect(mail).toMatchObject({
			attachments: [{ bytes, contentType: 'application/pdf', filename: 'flyer.pdf' }],
			idempotencyKey: entry.id,
			messageId: entry.messageId,
		});
		const other = sent(await prepareFor(c, second, { storage }, run)).mail;
		expect(other.attachments).toStrictEqual(mail.attachments);
		expect(reads()).toHaveLength(1);
	});

	it('reads the files of the wave of each sender once per run while the lanes take turns', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		await member(c.db, '1');
		await member(c.db, '2');
		const otherOccasion = await secondOccasion(c);
		const memory = createMemoryStorage();
		const flyer = await storeAttachment(c.db, memory, c.sender, c.occasionId, {
			bytes: pdfBytes(1000),
			name: 'einladung.pdf',
		});
		const program = await storeAttachment(c.db, memory, c.sender, otherOccasion, {
			bytes: pdfBytes(2000),
			name: 'programm.pdf',
		});
		const first = await entriesOfWave(c.db, await confirmTestWave(c, NOW, [flyer.id]));
		const other = { ...c, occasionId: otherOccasion };
		const second = await entriesOfWave(c.db, await confirmTestWave(other, NOW, [program.id]));
		const { reads, storage } = countingReads(memory);
		const turns = takingTurns(first, second);
		await expect(filesInTurn(c, startRun(), turns, storage)).resolves.toStrictEqual([
			['einladung.pdf'],
			['programm.pdf'],
			['einladung.pdf'],
			['programm.pdf'],
		]);
		expect(reads()).toHaveLength(2);
	});

	it('fails an entry whose file is gone and waits for a storage', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		const id = await member(c.db, '1');
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(2000),
			name: 'flyer.pdf',
		});
		await confirmTestWave(c, NOW, [flyer.id]);
		await expect(prepareFor(c, id, { storage: null })).rejects.toThrow(/storage/u);
		await storage.delete(attachmentStorageKey(flyer.id));
		await expect(prepareFor(c, id, { storage })).resolves.toStrictEqual({
			code: 'attachmentMissing',
			kind: 'fail',
		});
	});
});
