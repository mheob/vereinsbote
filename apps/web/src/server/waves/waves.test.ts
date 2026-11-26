import { randomUUID } from 'node:crypto';

import { count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { emptyTemplate } from '@/mail/starters/starters';
import { storeAttachment } from '@/server/attachments/attachments';
import { pdfBytes } from '@/server/attachments/testing';
import { insertContact } from '@/server/contacts/testing';
import {
	attachments,
	auditLog,
	outboxEntries,
	sendQuotaDays,
	senders,
	waveContacts,
	waves,
} from '@/server/db/schema';
import { OccasionInvalidError } from '@/server/occasions/errors';
import { removeOccasion } from '@/server/occasions/occasions';
import { insertOccasion } from '@/server/occasions/testing';
import { ForbiddenError } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';
import { getTemplate } from '@/server/templates/templates';
import { APP_ORIGIN, saveTemplate } from '@/server/templates/testing';

import { WaveAttachmentsGoneError } from './errors';
import type { RecipientSelection } from './recipients';
import { insertWave, setUpWaveClub } from './testing';
import type { WaveClub } from './testing';
import { confirmWave, summarizeWave } from './waves';
import type { ConfirmedWave, WaveSummaryInput } from './waves';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const EVERY_MEMBER: RecipientSelection = {
	contactIds: null,
	filters: {},
	kind: 'member',
	query: '',
};

/**
 * The summary input of the club's occasion: every member, no attachment.
 *
 * @param c The club.
 * @param overrides Other values.
 * @returns The input.
 */
function inputOf(c: WaveClub, overrides: Partial<WaveSummaryInput> = {}): WaveSummaryInput {
	return { attachmentIds: [], occasionId: c.occasionId, selection: EVERY_MEMBER, ...overrides };
}

/**
 * The confirmation input: the summary input, a fresh request id and "sofort".
 *
 * @param c The club.
 * @param overrides Other values.
 * @returns The input.
 */
function confirmationOf(
	c: WaveClub,
	overrides: Partial<WaveSummaryInput & { requestId: string; notBefore: Date | null }> = {},
): WaveSummaryInput & { requestId: string; notBefore: Date | null } {
	return { ...inputOf(c), notBefore: null, requestId: randomUUID(), ...overrides };
}

/**
 * A member with an address made from the number.
 *
 * @param db The database.
 * @param memberNumber The member number.
 * @param email The address; by default one of its own.
 * @returns The id.
 */
async function member(db: WaveClub['db'], memberNumber: string, email?: string): Promise<string> {
	return insertContact(db, {
		email: email ?? `mitglied-${memberNumber}@example.org`,
		kind: 'member',
		memberNumber,
	});
}

/**
 * The id of a confirmed wave.
 *
 * @param result What `confirmWave` gave.
 * @returns The id.
 */
function waveIdOf(result: Readonly<ConfirmedWave>): string {
	if (!('waveId' in result)) throw new Error(`The wave was refused: ${result.refused}`);
	return result.waveId;
}

/**
 * How many rows the wave tables hold.
 *
 * @param db The database.
 * @returns The rows of waves and outbox entries.
 */
async function countsOf(db: WaveClub['db']): Promise<{ waves: number; entries: number }> {
	const [waveRows] = await db.select({ n: count() }).from(waves);
	const [entryRows] = await db.select({ n: count() }).from(outboxEntries);
	return { entries: entryRows?.n ?? 0, waves: waveRows?.n ?? 0 };
}

/**
 * A template whose heading holds a placeholder.
 *
 * @param key The placeholder key.
 * @returns The template.
 */
function templateWith(key: string): ReturnType<typeof emptyTemplate> {
	return {
		...emptyTemplate({ name: 'Einladung', subject: 'Sommerfest' }),
		body: {
			blocks: [
				{
					content: [{ attrs: { fallback: null, key }, type: 'placeholder' }],
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

describe('creating a wave', () => {
	it('stores the compiled template, so later template changes do not touch the wave', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		await member(c.db, '2');
		const confirmed = await confirmWave(c.db, c.sender, confirmationOf(c), APP_ORIGIN, NOW);
		expect(confirmed).toMatchObject({ mails: 2 });
		const waveId = waveIdOf(confirmed);
		const template = await getTemplate(c.db, c.editor, c.templateId);
		const { body, name, preheader, salutationForm, salutationTexts } = template;
		await saveTemplate(
			c.db,
			c.editor,
			c.templateId,
			{ body, name, preheader, salutationForm, salutationTexts, subject: 'Herbstfest' },
			template.version,
		);
		const [wave] = await c.db.select().from(waves).where(eq(waves.id, waveId));
		expect(wave?.compiled.subject).toStrictEqual([{ kind: 'text', value: 'Sommerfest' }]);
		expect(wave).toMatchObject({
			areaId: c.membersAreaId,
			createdByUserId: c.sender.userId,
			kind: 'circular',
			notBefore: null,
			occasionId: c.occasionId,
			salutationTexts: DEFAULT_SALUTATIONS.du,
			senderId: c.senderId,
			stoppedAt: null,
			templateId: c.templateId,
			templateVersion: template.version,
			unsubscribe: true,
		});
	});

	it('plans one entry per address of a circular and keeps the merged contacts', async () => {
		const c = await setUpWaveClub();
		const family = 'familie@example.org';
		const second = await member(c.db, '2', family);
		const first = await member(c.db, '1', family);
		const solo = await member(c.db, '3');
		const summary = await summarizeWave(c.db, c.sender, inputOf(c), APP_ORIGIN, NOW);
		expect(summary).toMatchObject({ mails: 2, merged: 1, problem: null });
		const waveId = waveIdOf(await confirmWave(c.db, c.sender, confirmationOf(c), APP_ORIGIN, NOW));
		const entries = await c.db
			.select({
				notBefore: outboxEntries.notBefore,
				priority: outboxEntries.priority,
				senderId: outboxEntries.senderId,
				source: outboxEntries.source,
				sourceId: outboxEntries.sourceId,
				status: outboxEntries.status,
			})
			.from(outboxEntries)
			.where(eq(outboxEntries.waveId, waveId));
		const planned = {
			notBefore: NOW,
			priority: 'group',
			senderId: c.senderId,
			source: 'wave',
			sourceId: waveId,
			status: 'planned',
		};
		expect(entries).toStrictEqual([planned, planned]);
		const contacts = await c.db
			.select({
				contactId: waveContacts.contactId,
				contactKey: waveContacts.contactKey,
				email: waveContacts.email,
				entryId: waveContacts.entryId,
				kind: waveContacts.kind,
				position: waveContacts.position,
			})
			.from(waveContacts)
			.orderBy(waveContacts.email, waveContacts.position);
		const entryOf = (contactId: string): string | undefined =>
			contacts.find((row) => row.contactId === contactId)?.entryId;
		expect(contacts).toStrictEqual([
			{
				contactId: first,
				contactKey: 'nr:1',
				email: family,
				entryId: entryOf(first),
				kind: 'member',
				position: 0,
			},
			{
				contactId: second,
				contactKey: 'nr:2',
				email: family,
				entryId: entryOf(first),
				kind: 'member',
				position: 1,
			},
			{
				contactId: solo,
				contactKey: 'nr:3',
				email: 'mitglied-3@example.org',
				entryId: entryOf(solo),
				kind: 'member',
				position: 0,
			},
		]);
	});

	it('plans one personal entry per contact', async () => {
		const c = await setUpWaveClub({ kind: 'personal' });
		await member(c.db, '1', 'familie@example.org');
		await member(c.db, '2', 'familie@example.org');
		const summary = await summarizeWave(c.db, c.sender, inputOf(c), APP_ORIGIN, NOW);
		expect(summary).toMatchObject({ mails: 2, merged: 0 });
		const waveId = waveIdOf(await confirmWave(c.db, c.sender, confirmationOf(c), APP_ORIGIN, NOW));
		const entries = await c.db
			.select({ priority: outboxEntries.priority })
			.from(outboxEntries)
			.where(eq(outboxEntries.waveId, waveId));
		expect(entries).toStrictEqual([{ priority: 'personal' }, { priority: 'personal' }]);
	});

	it('logs the occasion and the number of mails, no names or addresses', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const waveId = waveIdOf(await confirmWave(c.db, c.sender, confirmationOf(c), APP_ORIGIN, NOW));
		const logged = await c.db
			.select({
				actorUserId: auditLog.actorUserId,
				details: auditLog.details,
				target: auditLog.target,
			})
			.from(auditLog)
			.where(eq(auditLog.action, 'wave.created'));
		expect(logged).toStrictEqual([
			{
				actorUserId: c.sender.userId,
				details: { mails: 1, occasionId: c.occasionId },
				target: `wave:${waveId}`,
			},
		]);
	});

	it('refuses a wave when a required brand value is missing, before any entry exists', async () => {
		const template = emptyTemplate({ name: 'Einladung', subject: 'Neu auf {{brand.website}}' });
		const c = await setUpWaveClub({ template });
		await member(c.db, '1');
		await expect(summarizeWave(c.db, c.sender, inputOf(c), APP_ORIGIN, NOW)).resolves.toMatchObject(
			{ mails: 1, problem: 'missingBrand' },
		);
		await expect(
			confirmWave(c.db, c.sender, confirmationOf(c), APP_ORIGIN, NOW),
		).resolves.toStrictEqual({ refused: 'missingBrand' });
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 0, waves: 0 });
	});

	it('refuses a template with {{unsubscribe.url}} for an occasion without link', async () => {
		const c = await setUpWaveClub({
			template: templateWith('unsubscribe.url'),
			unsubscribe: false,
		});
		await member(c.db, '1');
		await expect(summarizeWave(c.db, c.sender, inputOf(c), APP_ORIGIN, NOW)).resolves.toMatchObject(
			{ problem: 'unsubscribe' },
		);
		await expect(
			confirmWave(c.db, c.sender, confirmationOf(c), APP_ORIGIN, NOW),
		).resolves.toStrictEqual({ refused: 'unsubscribe' });
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 0, waves: 0 });
	});

	it('refuses a wave without recipients', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const nobody = { ...EVERY_MEMBER, contactIds: [] };
		await expect(
			summarizeWave(c.db, c.sender, inputOf(c, { selection: nobody }), APP_ORIGIN, NOW),
		).resolves.toMatchObject({ estimatedDays: 0, mails: 0, problem: 'noRecipients' });
		await expect(
			confirmWave(c.db, c.sender, confirmationOf(c, { selection: nobody }), APP_ORIGIN, NOW),
		).resolves.toStrictEqual({ refused: 'noRecipients' });
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 0, waves: 0 });
	});

	it('returns the same wave for the same request id', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		await member(c.db, '2');
		const confirmation = confirmationOf(c);
		const first = await confirmWave(c.db, c.sender, confirmation, APP_ORIGIN, NOW);
		expect(first).toMatchObject({ existing: false, mails: 2, notBefore: null });
		await member(c.db, '3');
		const again = await confirmWave(c.db, c.sender, confirmation, APP_ORIGIN, NOW);
		expect(again).toStrictEqual({ ...first, existing: true });
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 2, waves: 1 });
	});

	it('answers a second confirmation of the flow with the start of the first', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const later = new Date(NOW.getTime() + DAY_MS);
		const requestId = randomUUID();
		const planned = await confirmWave(
			c.db,
			c.sender,
			confirmationOf(c, { notBefore: later, requestId }),
			APP_ORIGIN,
			NOW,
		);
		expect(planned).toMatchObject({ existing: false, notBefore: later });
		// The other tab chose „Sofort“: the wave starts when the first confirmation said.
		await expect(
			confirmWave(c.db, c.sender, confirmationOf(c, { requestId }), APP_ORIGIN, NOW),
		).resolves.toStrictEqual({ ...planned, existing: true, notBefore: later });
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 1, waves: 1 });
	});

	it('returns the wave of a retried confirmation after the occasion was archived', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const confirmation = confirmationOf(c);
		const first = await confirmWave(c.db, c.sender, confirmation, APP_ORIGIN, NOW);
		await expect(removeOccasion(c.db, c.editor, c.occasionId, 1)).resolves.toBe('archived');
		await expect(confirmWave(c.db, c.sender, confirmation, APP_ORIGIN, NOW)).resolves.toStrictEqual(
			{ ...first, existing: true },
		);
		// Still only for whoever may send there.
		await expect(confirmWave(c.db, c.editor, confirmation, APP_ORIGIN, NOW)).rejects.toThrow(
			ForbiddenError,
		);
	});

	it('schedules a wave from now to one year ahead', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const confirmAt = async (notBefore: Date): ReturnType<typeof confirmWave> =>
			confirmWave(c.db, c.sender, confirmationOf(c, { notBefore }), APP_ORIGIN, NOW);
		const justBefore = new Date(NOW.getTime() - 1);
		await expect(confirmAt(justBefore)).resolves.toStrictEqual({
			refused: 'scheduleOutOfRange',
		});
		await expect(confirmAt(new Date('2027-11-26T09:00:00.001Z'))).resolves.toStrictEqual({
			refused: 'scheduleOutOfRange',
		});
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 0, waves: 0 });
		const later = new Date(NOW.getTime() + DAY_MS);
		const waveId = waveIdOf(
			await confirmWave(c.db, c.sender, confirmationOf(c, { notBefore: later }), APP_ORIGIN, NOW),
		);
		const [wave] = await c.db.select().from(waves).where(eq(waves.id, waveId));
		const [entry] = await c.db.select().from(outboxEntries).where(eq(outboxEntries.waveId, waveId));
		expect({ entry: entry?.notBefore, wave: wave?.notBefore }).toStrictEqual({
			entry: later,
			wave: later,
		});
		// One year ahead to the millisecond is still allowed.
		await expect(confirmAt(new Date('2027-11-26T09:00:00.000Z'))).resolves.toHaveProperty('waveId');
	});

	it('needs send in the area', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		await expect(summarizeWave(c.db, c.editor, inputOf(c), APP_ORIGIN, NOW)).rejects.toThrow(
			ForbiddenError,
		);
		await expect(confirmWave(c.db, c.editor, confirmationOf(c), APP_ORIGIN, NOW)).rejects.toThrow(
			ForbiddenError,
		);
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 0, waves: 0 });
	});

	it('refuses an archived occasion', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		await insertWave(c.db, c.occasionId);
		await expect(removeOccasion(c.db, c.editor, c.occasionId, 1)).resolves.toBe('archived');
		await expect(summarizeWave(c.db, c.sender, inputOf(c), APP_ORIGIN, NOW)).rejects.toThrow(
			OccasionInvalidError,
		);
		await expect(confirmWave(c.db, c.sender, confirmationOf(c), APP_ORIGIN, NOW)).rejects.toThrow(
			OccasionInvalidError,
		);
	});
});

describe('the attachments of a wave', () => {
	it('refuses attachments too large for graph', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(3_000_000),
			name: 'flyer.pdf',
		});
		const withFlyer = { attachmentIds: [flyer.id] };
		await expect(
			summarizeWave(c.db, c.sender, inputOf(c, withFlyer), APP_ORIGIN, NOW),
		).resolves.toMatchObject({ attachmentsBytes: 3_000_000, graphTooLarge: true, problem: null });
		await expect(
			confirmWave(c.db, c.sender, confirmationOf(c, withFlyer), APP_ORIGIN, NOW),
		).resolves.toStrictEqual({ refused: 'graphTooLarge' });
		const [row] = await c.db.select().from(attachments).where(eq(attachments.id, flyer.id));
		expect(row?.waveId).toBeNull();
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 0, waves: 0 });
	});

	it('links the attachments to the wave; resend takes what graph cannot', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		await member(c.db, '1');
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(3_000_000),
			name: 'flyer.pdf',
		});
		const withFlyer = { attachmentIds: [flyer.id] };
		await expect(
			summarizeWave(c.db, c.sender, inputOf(c, withFlyer), APP_ORIGIN, NOW),
		).resolves.toMatchObject({ attachmentsBytes: 3_000_000, graphTooLarge: false });
		const waveId = waveIdOf(
			await confirmWave(c.db, c.sender, confirmationOf(c, withFlyer), APP_ORIGIN, NOW),
		);
		const [row] = await c.db.select().from(attachments).where(eq(attachments.id, flyer.id));
		expect(row?.waveId).toBe(waveId);
	});

	it('takes only attachments of the occasion that no wave holds', async () => {
		const c = await setUpWaveClub();
		await member(c.db, '1');
		const storage = createMemoryStorage();
		const otherOccasion = await insertOccasion(c.db, c.admin, c.membersAreaId, 'Rundbrief');
		const foreign = await storeAttachment(c.db, storage, c.sender, otherOccasion, {
			bytes: pdfBytes(),
			name: 'fremd.pdf',
		});
		const own = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(),
			name: 'eigen.pdf',
		});
		const withForeign = { attachmentIds: [own.id, foreign.id] };
		await expect(
			summarizeWave(c.db, c.sender, inputOf(c, withForeign), APP_ORIGIN, NOW),
		).rejects.toThrow(WaveAttachmentsGoneError);
		await expect(
			confirmWave(c.db, c.sender, confirmationOf(c, withForeign), APP_ORIGIN, NOW),
		).rejects.toThrow(WaveAttachmentsGoneError);
		const withOwn = { attachmentIds: [own.id] };
		await confirmWave(c.db, c.sender, confirmationOf(c, withOwn), APP_ORIGIN, NOW);
		await expect(
			confirmWave(c.db, c.sender, confirmationOf(c, withOwn), APP_ORIGIN, NOW),
		).rejects.toThrow(WaveAttachmentsGoneError);
		await expect(countsOf(c.db)).resolves.toStrictEqual({ entries: 1, waves: 1 });
	});
});

describe('the duration of a wave', () => {
	it('estimates the days from the daily limit and the reserve', async () => {
		const c = await setUpWaveClub();
		await c.db.update(senders).set({ dailyLimit: 10 }).where(eq(senders.id, c.senderId));
		for (const memberNumber of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
			// oxlint-disable-next-line no-await-in-loop -- members one after another
			await member(c.db, memberNumber);
		}
		await c.db
			.insert(sendQuotaDays)
			.values({ count: 4, day: '2026-11-26', scope: `sender:${c.senderId}` });
		const entry = {
			senderId: c.senderId,
			source: 'wave' as const,
			sourceId: randomUUID(),
		};
		await c.db.insert(outboxEntries).values([
			// The reserve: two personal mails due today.
			{ ...entry, notBefore: new Date(NOW.getTime() + HOUR_MS), priority: 'personal' },
			{ ...entry, notBefore: new Date(NOW.getTime() + 2 * HOUR_MS), priority: 'personal' },
			// A circular planned before this wave goes first.
			{ ...entry, notBefore: new Date(NOW.getTime() - HOUR_MS), priority: 'group' },
			// Tomorrow's circular does not.
			{ ...entry, notBefore: new Date(NOW.getTime() + DAY_MS), priority: 'group' },
		]);
		// 10 mails: 4 fit today (10 − 4 sent − 2 reserved), then 8 a day: 2 days.
		await expect(summarizeWave(c.db, c.sender, inputOf(c), APP_ORIGIN, NOW)).resolves.toMatchObject(
			{ estimatedDays: 2, mails: 9 },
		);
		await c.db.update(senders).set({ dailyLimit: null }).where(eq(senders.id, c.senderId));
		await expect(summarizeWave(c.db, c.sender, inputOf(c), APP_ORIGIN, NOW)).resolves.toMatchObject(
			{ estimatedDays: 1 },
		);
	});

	it('does not hold the reserve back from a personal wave', async () => {
		const c = await setUpWaveClub({ kind: 'personal' });
		// Held back, the reserve of one would leave one mail for today and the second for tomorrow.
		await c.db.update(senders).set({ dailyLimit: 2 }).where(eq(senders.id, c.senderId));
		await member(c.db, '1');
		await member(c.db, '2');
		await c.db.insert(outboxEntries).values({
			notBefore: new Date(NOW.getTime() + HOUR_MS),
			priority: 'personal',
			senderId: c.senderId,
			source: 'wave',
			sourceId: randomUUID(),
		});
		await expect(summarizeWave(c.db, c.sender, inputOf(c), APP_ORIGIN, NOW)).resolves.toMatchObject(
			{ estimatedDays: 1, mails: 2 },
		);
	});
});
