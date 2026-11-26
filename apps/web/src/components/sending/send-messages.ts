/*
 * The texts of the send flow that depend on what the server returned: the counts of a summary,
 * the estimate, the problems and refusals of a wave, and the outcome of an upload or a test mail.
 * Pure: the components translate what these return. No message carries a contact's data.
 */
import type { MessageKey, MessageParams } from '@/i18n/translate';
import type { AttachmentFailure } from '@/server/attachments/failures';
import type { SendTestMailResult, WaveFailure } from '@/server/waves/failures';
import type { ShownExclusion } from '@/server/waves/recipients';
import type { TestMailRefusal } from '@/server/waves/test-mail-content';
import { TEST_MAILS_PER_HOUR } from '@/server/waves/test-mail-limit';
import type { WaveProblem, WaveRefusal, WaveSummary } from '@/server/waves/waves';

/** A text with its parameters. */
type Message = Readonly<{ key: MessageKey; params: MessageParams }>;

/** One row of the counts: its label and its number. */
interface CountRow {
	readonly label: MessageKey;
	readonly value: number;
}

/**
 * The reasons in the order the server checks them (`exclusionOf`); `unavailable` stands for an exit
 * the user may not see (ruling R10).
 */
const REASONS: readonly ShownExclusion[] = [
	'suppressed',
	'exited',
	'unavailable',
	'noEmail',
	'invalidEmail',
	'optedOutOccasion',
	'optedOutArea',
];

const PROBLEMS: Readonly<Record<WaveProblem, MessageKey>> = {
	compile: 'send.problem.compile',
	missingBrand: 'send.problem.missingBrand',
	noRecipients: 'send.problem.noRecipients',
	unsubscribe: 'send.problem.unsubscribe',
};

const FAILURES: Readonly<Record<WaveFailure['failure'], MessageKey>> = {
	archived: 'send.archived',
	attachmentsGone: 'send.attachmentsGone',
	changed: 'send.changed',
	gone: 'occasions.gone',
};

const TEST_MAIL_FAILURES: Readonly<Record<'contactGone' | 'notSent' | 'uncertain', MessageKey>> = {
	contactGone: 'send.previewContactGone',
	notSent: 'send.testMail.notSent',
	uncertain: 'send.testMail.uncertain',
};

/**
 * The counts of a summary: the mails, the addresses several contacts share (when there are any)
 * and every reason that excluded somebody.
 *
 * @param summary The summary.
 * @returns The rows.
 */
function summaryRows(summary: Readonly<WaveSummary>): CountRow[] {
	return [
		{ label: 'send.summary.mails', value: summary.mails },
		...(summary.merged > 0
			? [{ label: 'send.summary.merged' as const, value: summary.merged }]
			: []),
		...REASONS.filter((reason) => summary.excluded[reason] > 0).map((reason) => ({
			label: `send.excluded.${reason}` as const,
			value: summary.excluded[reason],
		})),
	];
}

/**
 * How long a wave takes, about: club days from today on, none without mails, or not foreseeable
 * when the reserve of personal mails leaves the circular nothing (`Infinity`).
 *
 * @param days `estimatedDays` of the summary.
 * @returns The message.
 */
function estimateMessage(days: number): Message {
	if (!Number.isFinite(days)) return { key: 'send.estimate.unforeseeable', params: {} };
	if (days <= 0) return { key: 'send.estimate.none', params: {} };
	if (days === 1) return { key: 'send.estimate.today', params: {} };
	return { key: 'send.estimate.days', params: { days } };
}

/**
 * The text of a problem that refuses a wave.
 *
 * @param problem The problem.
 * @returns Its key.
 */
function problemMessage(problem: WaveProblem): MessageKey {
	return PROBLEMS[problem];
}

/**
 * Why a counted wave cannot be confirmed, if it cannot: a problem of the template or the
 * selection, or attachments too large for Graph.
 *
 * @param summary The summary, or null while it is not counted.
 * @returns The key of the reason, or null.
 */
function blockOf(summary: Readonly<WaveSummary> | null): MessageKey | null {
	if (summary === null) return null;
	if (summary.problem !== null) return problemMessage(summary.problem);
	return summary.graphTooLarge ? 'send.graphTooLarge' : null;
}

/**
 * The text of a refused confirmation.
 *
 * @param reason Why the confirmation made no wave.
 * @returns Its key.
 */
function confirmRefusalMessage(reason: WaveRefusal): MessageKey {
	if (reason === 'graphTooLarge') return 'send.graphTooLarge';
	if (reason === 'scheduleOutOfRange') return 'send.scheduleOutOfRange';
	return problemMessage(reason);
}

/**
 * The text of a failure of the flow: the occasion is gone, archived or changed, or a file is gone.
 *
 * @param failure The failure.
 * @returns Its key.
 */
function waveFailureMessage(failure: WaveFailure['failure']): MessageKey {
	return FAILURES[failure];
}

/**
 * The text of a refused upload or removal of a file.
 *
 * @param failure The failure.
 * @returns Its key.
 */
function attachmentFailureMessage(failure: AttachmentFailure): MessageKey {
	if (failure.failure === 'invalid') return `send.attachment.${failure.problem}`;
	if (failure.failure === 'archived') return 'send.archived';
	return `send.attachment.${failure.failure}`;
}

/**
 * An alert.
 *
 * @param key The text.
 * @param params Its parameters.
 * @returns The message as an alert.
 */
function alert(
	key: MessageKey,
	params: MessageParams = {},
): Readonly<{ message: Message; tone: 'alert' }> {
	return { message: { key, params }, tone: 'alert' };
}

/**
 * The alert of a refused test mail.
 *
 * @param refused The refusal.
 * @param refused.reason Why it was refused.
 * @param refused.keys The missing values of `missing`.
 * @param names Names the missing values by their labels.
 * @returns The alert.
 */
function refusedTestMailMessage(
	refused: Readonly<{ reason: TestMailRefusal; keys: readonly string[] }>,
	names: (keys: readonly string[]) => string,
): Readonly<{ message: Message; tone: 'alert' }> {
	const { keys, reason } = refused;
	if (reason === 'missing') return alert('send.testMail.missing', { list: names(keys) });
	if (reason === 'rate') return alert('send.testMail.rate', { count: TEST_MAILS_PER_HOUR });
	return alert(`send.testMail.${reason}`);
}

/**
 * What the page says after a test mail: where it went, or why it did not.
 *
 * @param result The result of the server function.
 * @param address The user's own address, where it went.
 * @param names Names the missing values by their labels.
 * @returns The message and whether it is an alert.
 */
function testMailMessage(
	result: SendTestMailResult,
	address: string,
	names: (keys: readonly string[]) => string,
): Readonly<{ message: Message; tone: 'alert' | 'status' }> {
	if (result.ok) {
		return { message: { key: 'send.testMailSent', params: { address } }, tone: 'status' };
	}
	if (result.failure === 'refused') return refusedTestMailMessage(result, names);
	const { failure } = result;
	if (failure === 'contactGone' || failure === 'notSent' || failure === 'uncertain') {
		return alert(TEST_MAIL_FAILURES[failure]);
	}
	return alert(waveFailureMessage(failure));
}

/**
 * The failure of the flow in a result of a test mail or a preview: the occasion is gone, archived
 * or changed, or a file is gone; the flow reacts to it besides the message.
 *
 * @param result The result of the server function.
 * @returns The failure, or null for a success or a refusal of this call alone.
 */
function flowFailureOf(
	result: Readonly<{ ok: true } | { ok: false; failure: string }>,
): WaveFailure['failure'] | null {
	if (result.ok) return null;
	const { failure } = result;
	return failure === 'archived' ||
		failure === 'attachmentsGone' ||
		failure === 'changed' ||
		failure === 'gone'
		? failure
		: null;
}

export {
	attachmentFailureMessage,
	blockOf,
	confirmRefusalMessage,
	estimateMessage,
	flowFailureOf,
	problemMessage,
	summaryRows,
	testMailMessage,
	waveFailureMessage,
};
export type { CountRow, Message };
