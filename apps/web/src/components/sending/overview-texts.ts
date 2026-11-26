/*
 * The texts of the sending overview: the state of a wave (`overview.state.*`), the counts of its
 * entries, and of an outbox entry its status (`outbox.status.*`) and its code (`outbox.code.*`), a
 * reason of a skip, a failure of the preparer or the provider, or a bounce. A missing required
 * value names its key; a code the app does not know falls back to a generic text that names it
 * (codes never carry a value or an address). Pure and browser-safe.
 */
import type { MessageKey, Translate } from '@/i18n/translate';
import type { EntryStatus } from '@/server/sending/outbox';
import type { WaveState } from '@/server/waves/overview';

/** The text of each state of a wave. */
const WAVE_STATE_KEYS = {
	done: 'overview.state.done',
	planned: 'overview.state.planned',
	running: 'overview.state.running',
	stopped: 'overview.state.stopped',
} as const satisfies Readonly<Record<WaveState, MessageKey>>;

/** The text of each status. */
const ENTRY_STATUS_KEYS = {
	bounced: 'outbox.status.bounced',
	cancelled: 'outbox.status.cancelled',
	failed: 'outbox.status.failed',
	planned: 'outbox.status.planned',
	sending: 'outbox.status.sending',
	sent: 'outbox.status.sent',
	skipped: 'outbox.status.skipped',
	uncertain: 'outbox.status.uncertain',
} as const satisfies Readonly<Record<EntryStatus, MessageKey>>;

/** Every status, in the order the overview lists their counts: the outcome first. */
const ENTRY_STATUSES: readonly EntryStatus[] = [
	'sent',
	'planned',
	'sending',
	'uncertain',
	'failed',
	'bounced',
	'skipped',
	'cancelled',
];

/**
 * The text of each code an entry can carry: the skip reasons of the preparer (with `unavailable`,
 * a reached exit for a user who may not see it), its failures, the outbox's own codes, the codes of
 * the providers and of the platform, and the bounces.
 */
const ENTRY_CODE_KEYS = {
	addressChanged: 'outbox.code.addressChanged',
	attachmentMissing: 'outbox.code.attachmentMissing',
	'bounce.hard': 'outbox.code.bounce.hard',
	'bounce.soft': 'outbox.code.bounce.soft',
	deleted: 'outbox.code.deleted',
	exited: 'outbox.code.exited',
	'graph.mailbox': 'outbox.code.graph.mailbox',
	'graph.network': 'outbox.code.graph.network',
	'graph.recipient': 'outbox.code.graph.recipient',
	'graph.rejected': 'outbox.code.graph.rejected',
	'graph.response': 'outbox.code.graph.response',
	'graph.server': 'outbox.code.graph.server',
	'graph.throttled': 'outbox.code.graph.throttled',
	'graph.tooLarge': 'outbox.code.graph.tooLarge',
	'graph.unauthorized': 'outbox.code.graph.unauthorized',
	'graph.unknown': 'outbox.code.graph.unknown',
	invalidEmail: 'outbox.code.invalidEmail',
	'mime.address': 'outbox.code.mime.address',
	noEmail: 'outbox.code.noEmail',
	optedOutArea: 'outbox.code.optedOutArea',
	optedOutOccasion: 'outbox.code.optedOutOccasion',
	'outbox.credentials': 'outbox.code.outbox.credentials',
	'outbox.interrupted': 'outbox.code.outbox.interrupted',
	'outbox.keyExpired': 'outbox.code.outbox.keyExpired',
	'outbox.noSender': 'outbox.code.outbox.noSender',
	'outbox.noSource': 'outbox.code.outbox.noSource',
	'outbox.prepare': 'outbox.code.outbox.prepare',
	'outbox.probe': 'outbox.code.outbox.probe',
	'outbox.send': 'outbox.code.outbox.send',
	'platform.subrequests': 'outbox.code.platform.subrequests',
	'resend.concurrent': 'outbox.code.resend.concurrent',
	'resend.domain': 'outbox.code.resend.domain',
	'resend.idempotency': 'outbox.code.resend.idempotency',
	'resend.network': 'outbox.code.resend.network',
	'resend.quota': 'outbox.code.resend.quota',
	'resend.rejected': 'outbox.code.resend.rejected',
	'resend.server': 'outbox.code.resend.server',
	'resend.throttled': 'outbox.code.resend.throttled',
	'resend.unauthorized': 'outbox.code.resend.unauthorized',
	suppressed: 'outbox.code.suppressed',
	unavailable: 'outbox.code.unavailable',
	waveGone: 'outbox.code.waveGone',
} as const satisfies Readonly<Record<string, MessageKey>>;

/** A code with a text of its own. */
type KnownEntryCode = keyof typeof ENTRY_CODE_KEYS;

/** The start of the code of a missing required value: `missing:<key>`. */
const MISSING_PREFIX = 'missing:';

/**
 * Whether a code has a text of its own; a missing required value has its own pattern.
 *
 * @param code The code.
 * @returns True for a known code.
 */
function isKnownEntryCode(code: string): code is KnownEntryCode {
	return Object.hasOwn(ENTRY_CODE_KEYS, code);
}

/**
 * The text of an entry's code.
 *
 * @param code The code, as the overview delivers it.
 * @param t Translates.
 * @returns The text; for an unknown code a generic one that names it.
 */
function entryCodeText(code: string, t: Translate): string {
	if (code.startsWith(MISSING_PREFIX)) {
		return t('outbox.code.missing', { key: code.slice(MISSING_PREFIX.length) });
	}
	return isKnownEntryCode(code) ? t(ENTRY_CODE_KEYS[code]) : t('outbox.code.unknown', { code });
}

/**
 * The text of an entry's status.
 *
 * @param status The status.
 * @param t Translates.
 * @returns The text.
 */
function entryStatusText(status: EntryStatus, t: Translate): string {
	return t(ENTRY_STATUS_KEYS[status]);
}

/**
 * The text of a wave's state.
 *
 * @param state The state.
 * @param t Translates.
 * @returns The text.
 */
function waveStateText(state: WaveState, t: Translate): string {
	return t(WAVE_STATE_KEYS[state]);
}

/**
 * The counts of a wave's entries as one line, „Gesendet: 3, Fehlgeschlagen: 1“: the statuses with
 * entries, the outcome first.
 *
 * @param counts The entries per status.
 * @param t Translates.
 * @returns The line, or „Keine Einträge“.
 */
function countsText(counts: Readonly<Record<EntryStatus, number>>, t: Translate): string {
	const parts = ENTRY_STATUSES.filter((status) => counts[status] > 0).map((status) =>
		t('overview.countItem', { count: counts[status], status: entryStatusText(status, t) }),
	);
	return parts.length === 0 ? t('overview.countsNone') : parts.join(', ');
}

export {
	countsText,
	ENTRY_STATUSES,
	entryCodeText,
	entryStatusText,
	isKnownEntryCode,
	waveStateText,
};
