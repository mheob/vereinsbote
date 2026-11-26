import { and, count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';

import { emptyTemplate } from '@/mail/starters/starters';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { storeAttachment } from '@/server/attachments/attachments';
import { pdfBytes } from '@/server/attachments/testing';
import { ContactNotFoundError } from '@/server/contacts/errors';
import { insertContact } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { auditLog, mailConnections, sendQuotaDays, user } from '@/server/db/schema';
import { OccasionInvalidError } from '@/server/occasions/errors';
import { removeOccasion } from '@/server/occasions/occasions';
import { ForbiddenError } from '@/server/permissions/principal';
import { fakeProviders, testEnv } from '@/server/sending/testing';
import type { FakeCall } from '@/server/sending/testing';
import { createMemoryStorage } from '@/server/storage/memory';

import { TestMailNotSentError } from './errors';
import { sendTestMail, TEST_MAILS_PER_HOUR } from './test-mail';
import { insertWave, setUpWaveClub } from './testing';
import type { WaveClub } from './testing';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');
const HOUR_MS = 3_600_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_GATEWAY = 502;
const TEST_LINK = 'https://bote.example.org/unsubscribe/test';

/**
 * A template whose heading greets a placeholder without fallback.
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
 * The address of a user.
 *
 * @param db The database.
 * @param userId The user.
 * @returns The address.
 */
async function addressOf(db: Db, userId: string): Promise<string> {
	const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
	if (row === undefined) throw new Error('The user does not exist.');
	return row.email;
}

/**
 * The test mail calls of a club's sender.
 *
 * @param c The club.
 * @param fetch The fake providers' `fetch`.
 * @param input What differs from a test mail for the contact without files.
 * @param at The instant.
 * @returns What `sendTestMail` gave.
 */
// oxlint-disable-next-line max-params -- the club, the fake, the input and the clock
async function testMail(
	c: WaveClub,
	fetch: typeof globalThis.fetch,
	input: Readonly<{ contactId: string; attachmentIds?: readonly string[] }>,
	at: Date = NOW,
): ReturnType<typeof sendTestMail> {
	return sendTestMail(
		{ db: c.db, env: testEnv(), fetch, now: () => at, storage: createMemoryStorage() },
		c.sender,
		{ attachmentIds: [], occasionId: c.occasionId, ...input },
	);
}

/**
 * The mails the fake providers took.
 *
 * @param calls The requests the fake saw.
 * @returns The send requests.
 */
function sends(calls: readonly FakeCall[]): FakeCall[] {
	return calls.filter(({ url }) => url.endsWith('/emails') || url.endsWith('/sendMail'));
}

/**
 * The `wave.test_sent` entries of the activity log.
 *
 * @param db The database.
 * @returns The entries.
 */
async function testSentEntries(
	db: Db,
): Promise<{ actorUserId: string | null; target: string | null; details: unknown }[]> {
	return db
		.select({
			actorUserId: auditLog.actorUserId,
			details: auditLog.details,
			target: auditLog.target,
		})
		.from(auditLog)
		.where(eq(auditLog.action, 'wave.test_sent'));
}

/**
 * Today's count of a quota scope.
 *
 * @param db The database.
 * @param scope The scope.
 * @returns The count.
 */
async function quotaCount(db: Db, scope: string): Promise<number> {
	const [row] = await db
		.select({ count: sendQuotaDays.count })
		.from(sendQuotaDays)
		.where(eq(sendQuotaDays.scope, scope));
	return row?.count ?? 0;
}

/**
 * The only mail the fake providers took.
 *
 * @param calls The requests the fake saw.
 * @returns Its request.
 */
function onlySend(calls: readonly FakeCall[]): FakeCall {
	const [sent, ...more] = sends(calls);
	if (sent === undefined || more.length > 0) throw new Error('Not exactly one mail was sent.');
	return sent;
}

/**
 * A test mail of a Resend club for the member Erika, whose first name the template greets.
 *
 * @returns The club and the JSON the fake Resend took.
 */
async function testMailToErika(): Promise<{ c: WaveClub; payload: Record<string, unknown> }> {
	const c = await setUpWaveClub({
		provider: 'resend',
		template: templateWith('contact.firstName'),
	});
	const erika = await insertContact(c.db, {
		email: 'erika@example.org',
		firstName: 'Erika',
		kind: 'member',
		memberNumber: '7',
	});
	const fake = fakeProviders();
	const result = await testMail(c, fake.fetch, { contactId: erika });
	if (!('ok' in result)) throw new Error(`The test mail was refused: ${result.refused}`);
	const payload = z.record(z.string(), z.unknown()).parse(JSON.parse(onlySend(fake.calls).body));
	return { c, payload };
}

describe('the test mail of the send flow', () => {
	it('sends a test mail to the user with the preview contact values and a [Test] subject', async () => {
		const { c, payload } = await testMailToErika();
		expect(payload).toMatchObject({
			subject: '[Test] Sommerfest',
			to: [await addressOf(c.db, c.sender.userId)],
		});
		expect(payload).toHaveProperty('html', expect.stringContaining('Hallo Erika'));
	});

	it('links the page of test mails and names no address of the contact', async () => {
		const { payload } = await testMailToErika();
		expect(payload).toHaveProperty('html', expect.stringContaining(TEST_LINK));
		expect(payload).toHaveProperty(['headers', 'List-Unsubscribe'], `<${TEST_LINK}>`);
		expect(JSON.stringify(payload)).not.toContain('erika@example.org');
	});

	it('logs the test mail without addresses and counts it against the daily limit', async () => {
		const { c } = await testMailToErika();
		await expect(testSentEntries(c.db)).resolves.toStrictEqual([
			{
				actorUserId: c.sender.userId,
				details: { attachments: 0 },
				target: `occasion:${c.occasionId}`,
			},
		]);
		await expect(quotaCount(c.db, `connection:${c.connectionId}`)).resolves.toBe(1);
	});

	it('limits test mails to twenty per user and hour', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const fake = fakeProviders();
		for (let sent = 0; sent < TEST_MAILS_PER_HOUR; sent += 1) {
			const at = new Date(NOW.getTime() + sent * 1000);
			// oxlint-disable-next-line no-await-in-loop -- the mails of one user, one after another
			await expect(testMail(c, fake.fetch, { contactId }, at)).resolves.toStrictEqual({ ok: true });
		}
		const lastOfHour = new Date(NOW.getTime() + HOUR_MS - 1);
		await expect(testMail(c, fake.fetch, { contactId }, lastOfHour)).resolves.toStrictEqual({
			refused: 'rate',
		});
		expect(sends(fake.calls)).toHaveLength(TEST_MAILS_PER_HOUR);
		// The first mail of the hour leaves the window: one is free again.
		const anHourLater = new Date(NOW.getTime() + HOUR_MS + 1);
		await expect(testMail(c, fake.fetch, { contactId }, anHourLater)).resolves.toStrictEqual({
			ok: true,
		});
		await expect(testMail(c, fake.fetch, { contactId }, anHourLater)).resolves.toStrictEqual({
			refused: 'rate',
		});
	});

	it('refuses a test mail too large for graph', async () => {
		const c = await setUpWaveClub();
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(3_000_000),
			name: 'flyer.pdf',
		});
		const fake = fakeProviders();
		await expect(
			sendTestMail(
				{ db: c.db, env: testEnv(), fetch: fake.fetch, now: () => NOW, storage },
				c.sender,
				{ attachmentIds: [flyer.id], contactId, occasionId: c.occasionId },
			),
		).resolves.toStrictEqual({ refused: 'graphTooLarge' });
		expect(sends(fake.calls)).toHaveLength(0);
		await expect(testSentEntries(c.db)).resolves.toHaveLength(0);
		await expect(quotaCount(c.db, `sender:${c.senderId}`)).resolves.toBe(0);
	});

	it('attaches the files of the flow and sends through graph within its limit', async () => {
		const c = await setUpWaveClub();
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(),
			name: 'flyer.pdf',
		});
		const fake = fakeProviders();
		await expect(
			sendTestMail(
				{ db: c.db, env: testEnv(), fetch: fake.fetch, now: () => NOW, storage },
				c.sender,
				{ attachmentIds: [flyer.id], contactId, occasionId: c.occasionId },
			),
		).resolves.toStrictEqual({ ok: true });
		const mime = Buffer.from(onlySend(fake.calls).body, 'base64').toString('utf8');
		expect(mime).toContain('Subject: [Test] Sommerfest');
		expect(mime).toContain('filename="flyer.pdf"');
		await expect(testSentEntries(c.db)).resolves.toMatchObject([{ details: { attachments: 1 } }]);
		await expect(quotaCount(c.db, `sender:${c.senderId}`)).resolves.toBe(1);
	});

	it('refuses a mail that lacks a required value, naming its key only', async () => {
		const c = await setUpWaveClub({
			provider: 'resend',
			template: templateWith('contact.firstName'),
		});
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const fake = fakeProviders();
		await expect(testMail(c, fake.fetch, { contactId })).resolves.toStrictEqual({
			keys: ['contact.firstName'],
			refused: 'missing',
		});
		expect(sends(fake.calls)).toHaveLength(0);
		await expect(testSentEntries(c.db)).resolves.toHaveLength(0);
	});

	it('refuses a template that does not compile for the occasion', async () => {
		const c = await setUpWaveClub({
			kind: 'personal',
			provider: 'resend',
			template: templateWith('unsubscribe.url'),
			unsubscribe: false,
		});
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const fake = fakeProviders();
		await expect(testMail(c, fake.fetch, { contactId })).resolves.toStrictEqual({
			refused: 'compile',
		});
		expect(sends(fake.calls)).toHaveLength(0);
	});

	it('sends a personal occasion without the unsubscribe link', async () => {
		const c = await setUpWaveClub({ kind: 'personal', provider: 'resend' });
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const fake = fakeProviders();
		await expect(testMail(c, fake.fetch, { contactId })).resolves.toStrictEqual({ ok: true });
		expect(onlySend(fake.calls).body).not.toContain('/unsubscribe');
	});

	it('needs send in the area and an occasion that is not archived', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const fake = fakeProviders();
		const deps = { db: c.db, env: testEnv(), fetch: fake.fetch, now: () => NOW, storage: null };
		const input = { attachmentIds: [], contactId, occasionId: c.occasionId };
		await expect(sendTestMail(deps, c.editor, input)).rejects.toThrow(ForbiddenError);
		await expect(sendTestMail(deps, c.admin, input)).rejects.toThrow(ForbiddenError);
		await insertWave(c.db, c.occasionId);
		await expect(removeOccasion(c.db, c.editor, c.occasionId, 1)).resolves.toBe('archived');
		await expect(sendTestMail(deps, c.sender, input)).rejects.toThrow(OccasionInvalidError);
		expect(sends(fake.calls)).toHaveLength(0);
	});

	it('refuses a contact that is gone', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		const fake = fakeProviders();
		await expect(testMail(c, fake.fetch, { contactId: crypto.randomUUID() })).rejects.toThrow(
			ContactNotFoundError,
		);
		expect(sends(fake.calls)).toHaveLength(0);
	});

	it('gives the slot back and disturbs the connection when the provider refuses the access', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const fake = fakeProviders({ send: HTTP_UNAUTHORIZED });
		await expect(testMail(c, fake.fetch, { contactId })).rejects.toThrow(TestMailNotSentError);
		await expect(testSentEntries(c.db)).resolves.toHaveLength(0);
		await expect(quotaCount(c.db, `connection:${c.connectionId}`)).resolves.toBe(0);
		const [connection] = await c.db
			.select({ code: mailConnections.disturbedCode })
			.from(mailConnections)
			.where(eq(mailConnections.id, c.connectionId));
		expect(connection?.code).not.toBeNull();
	});

	it('keeps the slot and counts a mail whose fate is unknown', async () => {
		const c = await setUpWaveClub();
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const fake = fakeProviders({ send: HTTP_BAD_GATEWAY });
		const error = await testMail(c, fake.fetch, { contactId }).catch((error_: unknown) => error_);
		expect(error).toBeInstanceOf(TestMailNotSentError);
		expect(error).toHaveProperty('uncertain', true);
		await expect(testSentEntries(c.db)).resolves.toHaveLength(1);
		await expect(quotaCount(c.db, `sender:${c.senderId}`)).resolves.toBe(1);
	});

	it('counts the test mails of each user apart', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		const contactId = await insertContact(c.db, { email: 'a@example.org', kind: 'member' });
		const fake = fakeProviders();
		await c.db.insert(auditLog).values(
			Array.from({ length: TEST_MAILS_PER_HOUR }, () => ({
				action: 'wave.test_sent',
				actorUserId: c.editor.userId,
				at: NOW,
				target: `occasion:${c.occasionId}`,
			})),
		);
		await expect(testMail(c, fake.fetch, { contactId })).resolves.toStrictEqual({ ok: true });
		const [own] = await c.db
			.select({ n: count() })
			.from(auditLog)
			.where(and(eq(auditLog.action, 'wave.test_sent'), eq(auditLog.actorUserId, c.sender.userId)));
		expect(own?.n).toBe(1);
	});
});
