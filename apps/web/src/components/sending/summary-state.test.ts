import { describe, expect, it } from 'vite-plus/test';

import type { WaveSummary } from '@/server/waves/waves';

import { summaryStateOf } from './summary-state';

const SUMMARY: WaveSummary = {
	attachmentsBytes: 0,
	estimatedDays: 1,
	excluded: {
		exited: 0,
		invalidEmail: 0,
		noEmail: 0,
		optedOutArea: 0,
		optedOutOccasion: 0,
		suppressed: 0,
		unavailable: 0,
	},
	graphTooLarge: false,
	mails: 3,
	merged: 0,
	problem: null,
};

describe(summaryStateOf, () => {
	it('counts until the answer to the current request is in', () => {
		const selection = { contactIds: null, filters: {}, kind: 'member', query: '' } as const;
		const request = { attachmentIds: [], recount: 1, selection };
		expect(summaryStateOf(request, null)).toStrictEqual({ status: 'counting' });
		expect(
			summaryStateOf(request, {
				request: { ...request, recount: 0 },
				state: { status: 'ready', summary: SUMMARY },
			}),
		).toStrictEqual({ status: 'counting' });
		expect(
			summaryStateOf(request, { request, state: { status: 'ready', summary: SUMMARY } }),
		).toStrictEqual({ status: 'ready', summary: SUMMARY });
		expect(summaryStateOf(request, { request, state: { status: 'failed' } })).toStrictEqual({
			status: 'failed',
		});
	});
});
