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
import { createMemoryStorage } from '@/server/storage/memory';
import { APP_ORIGIN } from '@/server/templates/testing';

import {
	confirmWaveResult,
	resendUncertainResult,
	stopWaveResult,
	summarizeWaveResult,
	waveFailure,
} from './failures';
import { confirmTestWave, insertWave, setUpWaveClub, waveEntryIds } from './testing';

const NOW = new Date('2026-11-26T09:00:00.000Z');
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
});
