import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vite-plus/test';

import { storeAttachment } from '@/server/attachments/attachments';
import { pdfBytes } from '@/server/attachments/testing';
import { insertContact } from '@/server/contacts/testing';
import { OccasionChangedError, OccasionInvalidError } from '@/server/occasions/errors';
import { removeOccasion } from '@/server/occasions/occasions';
import { ForbiddenError } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';
import { APP_ORIGIN } from '@/server/templates/testing';

import { confirmWaveResult, summarizeWaveResult, waveFailure } from './failures';
import { insertWave, setUpWaveClub } from './testing';

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
