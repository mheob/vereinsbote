import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { storeAttachment } from '@/server/attachments/attachments';
import { pdfBytes } from '@/server/attachments/testing';
import { insertContact } from '@/server/contacts/testing';
import { outboxEntries } from '@/server/db/schema';
import { OccasionChangedError, OccasionInvalidError } from '@/server/occasions/errors';
import { removeOccasion } from '@/server/occasions/occasions';
import { ForbiddenError } from '@/server/permissions/principal';
import { fakeProviders, testEnv } from '@/server/sending/testing';
import { createMemoryStorage } from '@/server/storage/memory';
import type { ObjectStorage } from '@/server/storage/storage';
import { APP_ORIGIN } from '@/server/templates/testing';

import {
	confirmWaveResult,
	recipientPreviewResult,
	resendUncertainResult,
	searchRecipientsResult,
	sendTestMailResult,
	stopWaveResult,
	summarizeWaveResult,
	waveFailure,
} from './failures';
import type { TestMailDeps } from './test-mail';
import { confirmTestWave, insertWave, setUpWaveClub, waveEntryIds } from './testing';
import type { WaveClub } from './testing';

const NOW = new Date('2026-11-26T09:00:00.000Z');
const HTTP_UNPROCESSABLE = 422;
const HTTP_BAD_GATEWAY = 502;
const EVERY_MEMBER = { contactIds: null, filters: {}, kind: 'member', query: '' } as const;

describe(waveFailure, () => {
	it('maps the expected refusals and nothing else', () => {
		expect(waveFailure(new OccasionChangedError())).toStrictEqual({
			failure: 'changed',
			ok: false,
		});
		expect(waveFailure(new OccasionInvalidError('archived'))).toStrictEqual({
			failure: 'archived',
			ok: false,
		});
		expect(waveFailure(new OccasionInvalidError('name'))).toBeNull();
		expect(waveFailure(new ForbiddenError('Forbidden'))).toBeNull();
		expect(waveFailure(new Error('boom'))).toBeNull();
	});
});

describe(summarizeWaveResult, () => {
	it('gives the summary, or the refusal as a result', async () => {
		const c = await setUpWaveClub();
		await insertContact(c.db, { email: 'anna@example.org', kind: 'member', memberNumber: '1' });
		const input = { attachmentIds: [], occasionId: c.occasionId, selection: EVERY_MEMBER };
		await expect(
			summarizeWaveResult(c.db, c.sender, input, APP_ORIGIN, NOW),
		).resolves.toMatchObject({ ok: true, summary: { mails: 1, problem: null } });
		await expect(
			summarizeWaveResult(c.db, c.sender, { ...input, occasionId: randomUUID() }, APP_ORIGIN, NOW),
		).resolves.toStrictEqual({ failure: 'gone', ok: false });
		await expect(
			summarizeWaveResult(
				c.db,
				c.sender,
				{ ...input, attachmentIds: ['x'.repeat(22)] },
				APP_ORIGIN,
				NOW,
			),
		).resolves.toStrictEqual({ failure: 'attachmentsGone', ok: false });
		await expect(
			summarizeWaveResult(c.db, c.editor, input, APP_ORIGIN, NOW),
		).rejects.toBeInstanceOf(ForbiddenError);
	});
});

describe(confirmWaveResult, () => {
	it('gives the wave, a refusal of the wave, or a failure', async () => {
		const c = await setUpWaveClub();
		await insertContact(c.db, { email: 'anna@example.org', kind: 'member', memberNumber: '1' });
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(3_000_000),
			name: 'flyer.pdf',
		});
		const confirmation = {
			attachmentIds: [],
			notBefore: null,
			occasionId: c.occasionId,
			requestId: randomUUID(),
			selection: EVERY_MEMBER,
		};
		await expect(
			confirmWaveResult(
				c.db,
				c.sender,
				{ ...confirmation, attachmentIds: [flyer.id] },
				APP_ORIGIN,
				NOW,
			),
		).resolves.toStrictEqual({ failure: 'refused', ok: false, reason: 'graphTooLarge' });
		await expect(
			confirmWaveResult(c.db, c.sender, confirmation, APP_ORIGIN, NOW),
		).resolves.toMatchObject({ mails: 1, ok: true });
		await insertWave(c.db, c.occasionId);
		await removeOccasion(c.db, c.editor, c.occasionId, 1);
		await expect(
			confirmWaveResult(
				c.db,
				c.sender,
				{ ...confirmation, requestId: randomUUID() },
				APP_ORIGIN,
				NOW,
			),
		).resolves.toStrictEqual({ failure: 'archived', ok: false });
	});
});

describe(stopWaveResult, () => {
	it('gives the cancelled entries, or that the wave is gone', async () => {
		const c = await setUpWaveClub();
		await insertContact(c.db, { email: 'anna@example.org', kind: 'member', memberNumber: '1' });
		const waveId = await confirmTestWave(c, NOW);
		await expect(stopWaveResult(c.db, c.sender, waveId)).resolves.toStrictEqual({
			cancelled: 1,
			ok: true,
		});
		await expect(stopWaveResult(c.db, c.sender, randomUUID())).resolves.toStrictEqual({
			failure: 'gone',
			ok: false,
		});
		await expect(stopWaveResult(c.db, c.editor, waveId)).rejects.toBeInstanceOf(ForbiddenError);
	});
});

describe(resendUncertainResult, () => {
	it('sends an uncertain entry again, or says why not', async () => {
		const c = await setUpWaveClub();
		await insertContact(c.db, { email: 'anna@example.org', kind: 'member', memberNumber: '1' });
		const [id = ''] = await waveEntryIds(c.db, await confirmTestWave(c, NOW));
		await expect(resendUncertainResult(c.db, c.sender, id)).resolves.toStrictEqual({
			failure: 'notUncertain',
			ok: false,
		});
		await c.db
			.update(outboxEntries)
			.set({ messageId: '<unklar@example.org>', status: 'uncertain' })
			.where(eq(outboxEntries.id, id));
		await expect(resendUncertainResult(c.db, c.sender, id)).resolves.toStrictEqual({ ok: true });
		await expect(resendUncertainResult(c.db, c.sender, randomUUID())).resolves.toStrictEqual({
			failure: 'gone',
			ok: false,
		});
		await expect(resendUncertainResult(c.db, c.editor, id)).rejects.toBeInstanceOf(ForbiddenError);
	});

	it('tells a stopped wave apart from an entry that is no longer uncertain', async () => {
		const c = await setUpWaveClub();
		await insertContact(c.db, { email: 'anna@example.org', kind: 'member', memberNumber: '1' });
		const waveId = await confirmTestWave(c, NOW);
		const [id = ''] = await waveEntryIds(c.db, waveId);
		await c.db
			.update(outboxEntries)
			.set({ messageId: '<unklar@example.org>', status: 'uncertain' })
			.where(eq(outboxEntries.id, id));
		await stopWaveResult(c.db, c.sender, waveId);
		await expect(resendUncertainResult(c.db, c.sender, id)).resolves.toStrictEqual({
			failure: 'stopped',
			ok: false,
		});
	});
});

describe(searchRecipientsResult, () => {
	it('gives the contacts, or that the occasion is gone', async () => {
		const c = await setUpWaveClub();
		const anna = await insertContact(c.db, { email: 'anna@example.org', kind: 'member' });
		const input = { occasionId: c.occasionId, selection: EVERY_MEMBER, term: '' };
		await expect(searchRecipientsResult(c.db, c.sender, input, NOW)).resolves.toMatchObject({
			contacts: [{ id: anna }],
			ok: true,
		});
		await expect(
			searchRecipientsResult(c.db, c.sender, { ...input, occasionId: randomUUID() }, NOW),
		).resolves.toStrictEqual({ failure: 'gone', ok: false });
		await expect(searchRecipientsResult(c.db, c.editor, input, NOW)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});
});

describe(recipientPreviewResult, () => {
	it('gives the preview, or that the contact or the occasion is gone', async () => {
		const c = await setUpWaveClub();
		const anna = await insertContact(c.db, { email: 'anna@example.org', kind: 'member' });
		const input = { contactId: anna, occasionId: c.occasionId, selection: EVERY_MEMBER };
		await expect(recipientPreviewResult(c.db, c.sender, input, NOW)).resolves.toMatchObject({
			ok: true,
			preview: { contactId: anna, excluded: null },
		});
		await expect(
			recipientPreviewResult(c.db, c.sender, { ...input, contactId: randomUUID() }, NOW),
		).resolves.toStrictEqual({ failure: 'contactGone', ok: false });
		await expect(
			recipientPreviewResult(c.db, c.sender, { ...input, occasionId: randomUUID() }, NOW),
		).resolves.toStrictEqual({ failure: 'gone', ok: false });
	});
});

/**
 * The dependencies of a test mail of a club at `NOW`.
 *
 * @param c The club.
 * @param fetch The fake providers' `fetch`.
 * @param storage The storage of the files.
 * @returns The dependencies.
 */
function testMailDeps(
	c: WaveClub,
	fetch: typeof globalThis.fetch,
	storage: ObjectStorage | null = null,
): TestMailDeps {
	return { db: c.db, env: testEnv(), fetch, now: () => NOW, storage };
}

describe(sendTestMailResult, () => {
	it('gives done, or that the contact or a file is gone', async () => {
		const c = await setUpWaveClub({ provider: 'resend' });
		const anna = await insertContact(c.db, { email: 'anna@example.org', kind: 'member' });
		const input = { attachmentIds: [], contactId: anna, occasionId: c.occasionId };
		const { fetch } = fakeProviders();
		await expect(
			sendTestMailResult(testMailDeps(c, fetch), c.sender, input),
		).resolves.toStrictEqual({ ok: true });
		const gone = { ...input, contactId: randomUUID() };
		await expect(sendTestMailResult(testMailDeps(c, fetch), c.sender, gone)).resolves.toStrictEqual(
			{ failure: 'contactGone', ok: false },
		);
		const noFile = { ...input, attachmentIds: ['x'.repeat(22)] };
		await expect(
			sendTestMailResult(testMailDeps(c, fetch), c.sender, noFile),
		).resolves.toStrictEqual({ failure: 'attachmentsGone', ok: false });
		await expect(
			sendTestMailResult(testMailDeps(c, fetch), c.editor, input),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it('names a mail the provider refused or answered unclearly', async () => {
		const c = await setUpWaveClub();
		const anna = await insertContact(c.db, { email: 'anna@example.org', kind: 'member' });
		const input = { attachmentIds: [], contactId: anna, occasionId: c.occasionId };
		const refusing = fakeProviders({ send: HTTP_UNPROCESSABLE }).fetch;
		await expect(
			sendTestMailResult(testMailDeps(c, refusing), c.sender, input),
		).resolves.toStrictEqual({ failure: 'notSent', ok: false });
		const unclear = fakeProviders({ send: HTTP_BAD_GATEWAY }).fetch;
		await expect(
			sendTestMailResult(testMailDeps(c, unclear), c.sender, input),
		).resolves.toStrictEqual({ failure: 'uncertain', ok: false });
	});

	it('names a refusal with its keys', async () => {
		const c = await setUpWaveClub();
		const anna = await insertContact(c.db, { email: 'anna@example.org', kind: 'member' });
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(3_000_000),
			name: 'flyer.pdf',
		});
		const input = { attachmentIds: [flyer.id], contactId: anna, occasionId: c.occasionId };
		const { fetch } = fakeProviders();
		await expect(
			sendTestMailResult(testMailDeps(c, fetch, storage), c.sender, input),
		).resolves.toStrictEqual({ failure: 'refused', keys: [], ok: false, reason: 'graphTooLarge' });
	});
});
