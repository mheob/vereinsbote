import { describe, expect, it, vi } from 'vite-plus/test';

import { insertContact } from '@/server/contacts/testing';
import { graphRequestBytes } from '@/server/sending/mime';
import { APP_ORIGIN } from '@/server/templates/testing';
import { unsubscribePayload, unsubscribeTokenLength } from '@/server/unsubscribe/token';

import { setUpWaveClub } from './testing';
import { summarizeWave } from './waves';

// The Graph size probe passes through; the test reads the mail it measured.
vi.mock(import('@/server/sending/mime'), async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, graphRequestBytes: vi.fn(actual.graphRequestBytes) };
});

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');
const FAMILY = 'familie-mit-langem-namen@example.org';
const EVERY_MEMBER = { contactIds: null, filters: {}, kind: 'member', query: '' } as const;

/**
 * The mail the last Graph size probe measured.
 *
 * @returns Its unsubscribe header, HTML and text.
 */
function lastProbe(): { header: string; html: string; text: string } {
	const [probe] = vi.mocked(graphRequestBytes).mock.lastCall ?? [];
	return { header: probe?.listUnsubscribe ?? '', html: probe?.html ?? '', text: probe?.text ?? '' };
}

describe('the graph size probe of a wave', () => {
	it('measures the unsubscribe link of the longest token in the header and the mail', async () => {
		const c = await setUpWaveClub();
		for (const number of ['1', '22', '333']) {
			// oxlint-disable-next-line no-await-in-loop -- three members of one household, one after another
			await insertContact(c.db, { email: FAMILY, kind: 'member', memberNumber: number });
		}
		await insertContact(c.db, { email: 'solo@example.org', kind: 'member', memberNumber: '4' });
		const input = { attachmentIds: [], occasionId: c.occasionId, selection: EVERY_MEMBER };
		await summarizeWave(c.db, c.sender, input, APP_ORIGIN, NOW);
		const household = unsubscribePayload(
			{ areaId: c.membersAreaId, occasionId: c.occasionId },
			['1', '22', '333'].map((number) => ({ contactKey: `nr:${number}`, kind: 'member' as const })),
		);
		const { header, html, text } = lastProbe();
		const prefix = `${APP_ORIGIN}/unsubscribe/`;
		expect(header).toBe(`${prefix}${'x'.repeat(unsubscribeTokenLength(household))}`);
		expect(html).toContain(`href="${header}"`);
		expect(text).toContain(header);
	});
});
