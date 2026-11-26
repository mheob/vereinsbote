import { describe, expect, it } from 'vite-plus/test';

import { setFieldAreas } from '@/server/contacts/settings';
import { insertContact } from '@/server/contacts/testing';
import { APP_ORIGIN } from '@/server/templates/testing';

import { setUpWaveClub } from './testing';
import { confirmWave, summarizeWave } from './waves';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');
const EVERY_MEMBER = { contactIds: null, filters: {}, kind: 'member', query: '' } as const;

describe('the exit date in the summary', () => {
	it('counts a reached exit as unavailable for a user who may not see exit dates', async () => {
		const c = await setUpWaveClub();
		const input = { attachmentIds: [], occasionId: c.occasionId, selection: EVERY_MEMBER };
		await insertContact(c.db, { email: 'mitglied@example.org', kind: 'member', memberNumber: '1' });
		await insertContact(c.db, {
			email: 'ausgetreten@example.org',
			exitDate: '2020-01-01',
			kind: 'member',
			memberNumber: '2',
		});
		await expect(summarizeWave(c.db, c.sender, input, APP_ORIGIN, NOW)).resolves.toMatchObject({
			excluded: { exited: 1, unavailable: 0 },
			mails: 1,
		});
		await setFieldAreas(c.db, c.admin, {
			areaIds: [c.partnersAreaId],
			fieldKey: 'exitDate',
			kind: 'member',
		});
		await expect(summarizeWave(c.db, c.sender, input, APP_ORIGIN, NOW)).resolves.toMatchObject({
			excluded: { exited: 0, unavailable: 1 },
			mails: 1,
		});
		// The wave itself still leaves the exited member out.
		const confirmation = { ...input, notBefore: null, requestId: crypto.randomUUID() };
		await expect(confirmWave(c.db, c.sender, confirmation, APP_ORIGIN, NOW)).resolves.toMatchObject(
			{ mails: 1 },
		);
	});
});
