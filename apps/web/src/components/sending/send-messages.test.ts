import { describe, expect, it } from 'vite-plus/test';

import { de } from '@/i18n/de';
import { en } from '@/i18n/en';
import type { WaveSummary } from '@/server/waves/waves';

import {
	attachmentFailureMessage,
	blockOf,
	confirmRefusalMessage,
	estimateMessage,
	flowFailureOf,
	problemMessage,
	summaryRows,
	testMailMessage,
	waveFailureMessage,
} from './send-messages';

const SUMMARY: WaveSummary = {
	attachmentsBytes: 0,
	estimatedDays: 1,
	excluded: {
		exited: 0,
		invalidEmail: 2,
		noEmail: 1,
		optedOutArea: 0,
		optedOutOccasion: 3,
		suppressed: 0,
		unavailable: 0,
	},
	graphTooLarge: false,
	mails: 12,
	merged: 4,
	problem: null,
};

const ADDRESS = 'ich@example.org';
const names = (keys: readonly string[]): string => keys.join(' + ');

describe(summaryRows, () => {
	it('lists the mails, the shared addresses and every reason that excluded somebody', () => {
		expect(summaryRows(SUMMARY)).toStrictEqual([
			{ label: 'send.summary.mails', value: 12 },
			{ label: 'send.summary.merged', value: 4 },
			{ label: 'send.excluded.noEmail', value: 1 },
			{ label: 'send.excluded.invalidEmail', value: 2 },
			{ label: 'send.excluded.optedOutOccasion', value: 3 },
		]);
	});

	it('names an exit the user may not see as unavailable', () => {
		const rows = summaryRows({ ...SUMMARY, excluded: { ...SUMMARY.excluded, unavailable: 2 } });
		expect(rows).toContainEqual({ label: 'send.excluded.unavailable', value: 2 });
	});

	it('leaves out shared addresses when there are none', () => {
		const rows = summaryRows({ ...SUMMARY, merged: 0 });
		expect(rows.map(({ label }) => label)).not.toContain('send.summary.merged');
	});
});

describe(estimateMessage, () => {
	it('says about how many club days the wave takes, or that it is not foreseeable', () => {
		expect(estimateMessage(0)).toStrictEqual({ key: 'send.estimate.none', params: {} });
		expect(estimateMessage(1)).toStrictEqual({ key: 'send.estimate.today', params: {} });
		expect(estimateMessage(3)).toStrictEqual({ key: 'send.estimate.days', params: { days: 3 } });
		expect(estimateMessage(Number.POSITIVE_INFINITY)).toStrictEqual({
			key: 'send.estimate.unforeseeable',
			params: {},
		});
	});
});

describe(problemMessage, () => {
	it('has a text for every problem of a wave', () => {
		for (const problem of ['compile', 'missingBrand', 'noRecipients', 'unsubscribe'] as const) {
			const key = problemMessage(problem);
			expect(de[key].length).toBeGreaterThan(0);
			expect(en[key].length).toBeGreaterThan(0);
		}
	});
});

describe(confirmRefusalMessage, () => {
	it('names the size limit of Graph and the range of a planned start', () => {
		expect(confirmRefusalMessage('graphTooLarge')).toBe('send.graphTooLarge');
		expect(confirmRefusalMessage('scheduleOutOfRange')).toBe('send.scheduleOutOfRange');
		expect(confirmRefusalMessage('unsubscribe')).toBe('send.problem.unsubscribe');
	});
});

describe(waveFailureMessage, () => {
	it('has a text for every failure of the flow', () => {
		expect(waveFailureMessage('gone')).toBe('occasions.gone');
		expect(waveFailureMessage('archived')).toBe('send.archived');
		expect(waveFailureMessage('attachmentsGone')).toBe('send.attachmentsGone');
		expect(waveFailureMessage('changed')).toBe('send.changed');
	});
});

describe(attachmentFailureMessage, () => {
	it.each([
		[{ failure: 'invalid', ok: false, problem: 'type' }, 'send.attachment.type'],
		[{ failure: 'invalid', ok: false, problem: 'total' }, 'send.attachment.total'],
		[{ failure: 'storageMissing', ok: false }, 'send.attachment.storageMissing'],
		[{ failure: 'archived', ok: false }, 'send.archived'],
		[{ failure: 'gone', ok: false }, 'send.attachment.gone'],
		[{ failure: 'locked', ok: false }, 'send.attachment.locked'],
	] as const)('names why a file was refused or could not be removed (%o)', (failure, key) => {
		expect(attachmentFailureMessage(failure)).toBe(key);
	});
});

describe(blockOf, () => {
	it('names a problem, attachments too large for graph, or nothing', () => {
		expect(blockOf(null)).toBeNull();
		expect(blockOf(SUMMARY)).toBeNull();
		expect(blockOf({ ...SUMMARY, problem: 'noRecipients' })).toBe('send.problem.noRecipients');
		expect(blockOf({ ...SUMMARY, graphTooLarge: true })).toBe('send.graphTooLarge');
	});
});

describe(testMailMessage, () => {
	it('tells where a sent test mail went', () => {
		expect(testMailMessage({ ok: true }, ADDRESS, names)).toStrictEqual({
			message: { key: 'send.testMailSent', params: { address: ADDRESS } },
			tone: 'status',
		});
	});

	it('names the missing values by their labels and the limit of the hour', () => {
		expect(
			testMailMessage(
				{
					failure: 'refused',
					keys: ['contact.firstName', 'contact.city'],
					ok: false,
					reason: 'missing',
				},
				ADDRESS,
				names,
			),
		).toStrictEqual({
			message: {
				key: 'send.testMail.missing',
				params: { list: 'contact.firstName + contact.city' },
			},
			tone: 'alert',
		});
		expect(
			testMailMessage({ failure: 'refused', keys: [], ok: false, reason: 'rate' }, ADDRESS, names),
		).toStrictEqual({
			message: { key: 'send.testMail.rate', params: { count: 20 } },
			tone: 'alert',
		});
	});

	it('has an alert for every other outcome', () => {
		const outcomes = [
			[
				{ failure: 'refused', keys: [], ok: false, reason: 'graphTooLarge' },
				'send.testMail.graphTooLarge',
			],
			[{ failure: 'refused', keys: [], ok: false, reason: 'compile' }, 'send.testMail.compile'],
			[{ failure: 'contactGone', ok: false }, 'send.previewContactGone'],
			[{ failure: 'notSent', ok: false }, 'send.testMail.notSent'],
			[{ failure: 'uncertain', ok: false }, 'send.testMail.uncertain'],
			[{ failure: 'archived', ok: false }, 'send.archived'],
			[{ failure: 'attachmentsGone', ok: false }, 'send.attachmentsGone'],
		] as const;
		for (const [result, key] of outcomes) {
			expect(testMailMessage(result, ADDRESS, names)).toStrictEqual({
				message: { key, params: {} },
				tone: 'alert',
			});
		}
	});
});

describe(flowFailureOf, () => {
	it('picks the failures of the flow out of a result', () => {
		expect(flowFailureOf({ ok: true })).toBeNull();
		expect(flowFailureOf({ failure: 'notSent', ok: false })).toBeNull();
		expect(flowFailureOf({ failure: 'refused', ok: false })).toBeNull();
		for (const failure of ['archived', 'attachmentsGone', 'changed', 'gone'] as const) {
			expect(flowFailureOf({ failure, ok: false })).toBe(failure);
		}
	});
});
