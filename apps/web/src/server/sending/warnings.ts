/*
 * The warnings to the admins about the senders (Spec 6.10, Design 15): a Graph secret that is
 * about to expire (once per stage of 30, 14, 7 and 1 day), a connection the provider refuses
 * (once per disturbance) and at most one digest a club day of new failed or uncertain entries of
 * the outbox. They run as one tick step and go to the active admins in their language. A mail
 * names the connection, the sender and the numbers, never a recipient or a secret.
 *
 * Every warning follows the order of the stale-data warning: the marker in `system_state` is set
 * first, so two runs never send it twice, then the mails go, then the activity log. When the log
 * entry fails, the marker is given back and the next tick warns again.
 *
 * Before the warnings the step checks the system sender's Graph token (`checkSystemSender`), so a
 * revoked or rotated secret shows as a disturbance even when no mail went through the sender.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { compareCodePoints } from '@/server/compare-code-points';
import {
	daysUntil,
	formatCalendarDate,
	formatClubDate,
	todayInClubZone,
} from '@/server/contacts/calendar';
import { WARNING_RETRY_MS, activeAdmins, tickMailer } from '@/server/contacts/stale-import';
import type { Recipient } from '@/server/contacts/stale-import';
import type { Db } from '@/server/db/client';
import { mailConnections, outboxEntries, senders } from '@/server/db/schema';
import { errorLabel } from '@/server/error-label';
import type { SystemMail, SystemMailer } from '@/server/mail/system-mailer';
import { clearState, getState, setState } from '@/server/system-state';
import type { StateKey } from '@/server/system-state';
import type { TickContext, TickStep } from '@/server/tick/tick';

import { disturbanceReason } from './disturbance';
import { checkSystemSender } from './system-mailer';

/** The days before the expiry of a secret at which the admins are warned, once each. */
// oxlint-disable-next-line no-magic-numbers -- the stages are the point of the list
const SECRET_WARNING_DAYS = [30, 14, 7, 1] as const;

type SecretStage = (typeof SECRET_WARNING_DAYS)[number];

/** The club day of the last digest. */
interface DigestMarker {
	readonly day: string;
}

/**
 * The stage a secret has reached: the smallest of the warning days that is not below the days it
 * has left. An expired secret stays in the last stage.
 *
 * @param expiresOn The last day the secret works, `YYYY-MM-DD`.
 * @param today The club's day, `YYYY-MM-DD`.
 * @returns The stage, or null while more than 30 days are left.
 */
function secretWarningStage(expiresOn: string, today: string): SecretStage | null {
	const days = daysUntil(today, expiresOn);
	return SECRET_WARNING_DAYS.findLast((stage) => stage >= days) ?? null;
}

/** The part of a connection the warnings look at. */
interface WatchedConnection {
	readonly id: string;
	readonly name: string;
	readonly secretExpiresOn: string | null;
	readonly disturbedSince: Date | null;
	readonly disturbedCode: string | null;
}

async function watchedConnections(db: Db): Promise<WatchedConnection[]> {
	return db
		.select({
			disturbedCode: mailConnections.disturbedCode,
			disturbedSince: mailConnections.disturbedSince,
			id: mailConnections.id,
			name: mailConnections.name,
			secretExpiresOn: mailConnections.secretExpiresOn,
		})
		.from(mailConnections)
		.orderBy(mailConnections.name, mailConnections.id);
}

/** What the page frame tells an admin about the connections. */
interface SendingNotice {
	/** A secret expires within the days of the first warning (or has expired). */
	readonly secretExpiring: boolean;
	readonly disturbed: boolean;
}

/**
 * Whether a connection needs the admins' attention now: a secret that expires within 30 days or a
 * connection the provider refuses.
 *
 * @param db The database.
 * @param now The instant; its club day counts.
 * @returns What to tell, or null when all is well.
 */
async function sendingNotice(db: Db, now: Date): Promise<SendingNotice | null> {
	const today = todayInClubZone(now);
	const connections = await watchedConnections(db);
	const secretExpiring = connections.some(
		({ secretExpiresOn }) =>
			secretExpiresOn !== null && secretWarningStage(secretExpiresOn, today) !== null,
	);
	const disturbed = connections.some(({ disturbedSince }) => disturbedSince !== null);
	return secretExpiring || disturbed ? { disturbed, secretExpiring } : null;
}

/** What every warning of one run shares. */
interface Run {
	readonly ctx: TickContext;
	readonly now: Date;
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the mailer is a behavior, not data
	readonly mailer: SystemMailer;
	/** The active admins; read when the first warning needs them. */
	admins: () => Promise<readonly Recipient[]>;
}

/** What one warning says, to whom and how it is logged. */
interface Notice {
	readonly key: StateKey;
	/** The marker before the claim; null when there was none. */
	readonly previous: unknown;
	/** The marker once the warning is claimed. */
	readonly next: unknown;
	readonly mail: (recipient: Readonly<Recipient>) => SystemMail;
	readonly action: AuditAction;
	readonly target?: string;
	readonly details: Readonly<Record<string, unknown>>;
	/** Names the warning in `sending_warning_retry`, e.g. `sending_secret_warned:<id>`. */
	readonly retryKey: string;
	/** Undoes what else the claim did (the digest marks its entries); runs with the marker. */
	readonly undo?: () => Promise<void>;
}

/**
 * Mails every admin; a failure is counted and logged by its code only, never by address.
 *
 * @param run The mailer.
 * @param recipients Who gets it.
 * @param mail What each one gets.
 * @returns How many mails went out, how many failed and the code of the last failure.
 */
async function mailAll(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Pick<Run, 'mailer'>>,
	recipients: readonly Readonly<Recipient>[],
	mail: Notice['mail'],
): Promise<{ sent: number; failed: number; error?: string }> {
	const outcome: { sent: number; failed: number; error?: string } = { failed: 0, sent: 0 };
	for (const recipient of recipients) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- one mail after the other, a failure must not stop the rest
			await run.mailer.send(mail(recipient));
			outcome.sent += 1;
		} catch (error) {
			outcome.failed += 1;
			outcome.error = errorLabel(error);
			// oxlint-disable-next-line no-console -- the code only, never the address
			console.error('sending warning failed', outcome.error);
		}
	}
	return outcome;
}

type RetryMap = Record<string, string>;

/**
 * Whether a warning that nobody received still waits for its next try.
 *
 * @param run The run.
 * @param retryKey The warning.
 * @returns True within an hour of the failed try.
 */
async function isWaiting(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
	retryKey: string,
): Promise<boolean> {
	const retry = await getState<RetryMap>(run.ctx.db, 'sending_warning_retry');
	const until = retry?.[retryKey];
	return until !== undefined && Date.parse(until) > run.now.getTime();
}

/**
 * Sets or clears the wait of a warning.
 *
 * @param run The run.
 * @param retryKey The warning.
 * @param waits True to wait an hour from now, false to forget the wait.
 */
async function setWaiting(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
	retryKey: string,
	waits: boolean,
): Promise<void> {
	const { db } = run.ctx;
	const retry = (await getState<RetryMap>(db, 'sending_warning_retry')) ?? {};
	const { [retryKey]: earlier, ...rest } = retry;
	if (!waits && earlier === undefined) return;
	const next = waits
		? { ...rest, [retryKey]: new Date(run.now.getTime() + WARNING_RETRY_MS).toISOString() }
		: rest;
	await setState(db, 'sending_warning_retry', next);
}

/**
 * Gives a claim back: the marker returns to what it was, and the claim's other marks go.
 *
 * @param db The database.
 * @param notice The warning.
 */
async function giveBack(db: Db, notice: Readonly<Notice>): Promise<void> {
	await (notice.previous === null
		? clearState(db, notice.key)
		: setState(db, notice.key, notice.previous));
	await notice.undo?.();
}

/**
 * Writes the activity log entry of a warning; when that fails the claim goes back and the error
 * goes on.
 *
 * @param db The database.
 * @param notice The warning.
 * @param outcome What the mails came to.
 */
async function logNotice(
	db: Db,
	notice: Readonly<Notice>,
	outcome: Readonly<Record<string, unknown>>,
): Promise<void> {
	try {
		await writeAudit(db, {
			action: notice.action,
			actorUserId: null,
			details: { ...notice.details, ...outcome },
			target: notice.target,
		});
	} catch (error) {
		// Without its log entry the warning does not count: the next tick tries again.
		await giveBack(db, notice);
		throw error;
	}
}

/**
 * Claims a warning, sends it and logs it. The claim relies on the tick lock: one run at a time
 * takes the marker. A warning that reached nobody (every mail failed, no active admin, no way to
 * send) gives the claim back and waits an hour; it writes no log entry. One that reached some
 * admins stays claimed, so no admin gets it twice. A log entry that fails gives the claim back
 * and throws.
 *
 * @param run The run.
 * @param notice The warning.
 * @returns True when the warning stays claimed.
 */
async function deliver(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
	notice: Readonly<Notice>,
): Promise<boolean> {
	const { db } = run.ctx;
	await setState(db, notice.key, notice.next);
	const outcome = await mailAll(run, await run.admins(), notice.mail);
	if (outcome.sent === 0) {
		await giveBack(db, notice);
		await setWaiting(run, notice.retryKey, true);
		return false;
	}
	await logNotice(db, notice, outcome);
	await setWaiting(run, notice.retryKey, false);
	return true;
}

/**
 * Runs one warning; a failure (a log entry that cannot be written) is logged by its code and does
 * not stop the other warnings of the tick.
 *
 * @param warning The warning.
 * @returns What the warning returned, or null when it failed.
 */
async function attempt<Result>(warning: () => Promise<Result>): Promise<Result | null> {
	try {
		return await warning();
	} catch (error) {
		// oxlint-disable-next-line no-console -- the code only, never an address
		console.error('sending warning not logged', errorLabel(error));
		return null;
	}
}

/**
 * What a kind of connection warning needs: the value that says where a connection stands (the
 * stage of its secret, the start of its disturbance), the log entry and the texts.
 */
interface Watch<Value extends number | string> {
	readonly key: StateKey;
	readonly action: AuditAction;
	readonly buttonKey: 'mail.system.sendingDisturbed.button' | 'mail.system.sendingSecret.button';
	/** Where the connection stands, or null while there is nothing to warn about. */
	readonly valueOf: (connection: Readonly<WatchedConnection>, today: string) => Value | null;
	readonly details: (
		connection: Readonly<WatchedConnection>,
		value: Value,
	) => Readonly<Record<string, unknown>>;
	readonly texts: (
		about: Readonly<{ locale: Locale; connection: Readonly<WatchedConnection>; today: string }>,
		value: Value,
	) => Readonly<{ subject: string; heading: string; text: string }>;
}

/** A connection to warn about and the value it reached. */
interface Pending<Value> {
	readonly connection: Readonly<WatchedConnection>;
	readonly value: Value;
}

/**
 * Sorts the connections: the marker keeps what was warned about already, and the connections
 * whose value changed since are pending. A connection that is quiet again drops out of the
 * marker, so a renewed secret or a new disturbance warns afresh.
 *
 * @param stored The stored marker, or null.
 * @param connections The connections.
 * @param valueOf Where a connection stands now.
 * @returns The marker to keep and the connections to warn about.
 */
function sortOut<Value extends number | string>(
	stored: Readonly<Record<string, Value>> | null,
	connections: readonly Readonly<WatchedConnection>[],
	valueOf: (connection: Readonly<WatchedConnection>) => Value | null,
): { marker: Record<string, Value>; pending: Pending<Value>[] } {
	const marker: Record<string, Value> = {};
	const pending: Pending<Value>[] = [];
	for (const connection of connections) {
		const value = valueOf(connection);
		const earlier = stored?.[connection.id];
		if (value !== null && earlier !== undefined) marker[connection.id] = earlier;
		if (value !== null && earlier !== value) pending.push({ connection, value });
	}
	return { marker, pending };
}

/**
 * The mail of a warning about one connection.
 *
 * @param run The run, for the link.
 * @param watch The kind of warning, for the button.
 * @param texts The texts of the language, from `Watch.texts`.
 * @param connection The connection.
 * @returns A function that builds the mail for a recipient.
 */
// oxlint-disable-next-line max-params -- the run, the kind, the texts and the connection
function connectionMail(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
	watch: Readonly<Pick<Watch<number>, 'buttonKey'>>,
	texts: (locale: Locale) => Readonly<{ subject: string; heading: string; text: string }>,
	connection: Readonly<Pick<WatchedConnection, 'id'>>,
): Notice['mail'] {
	const url = new URL(`/admin/sending/connections/${connection.id}`, run.ctx.env.appUrl).toString();
	return (recipient) => {
		const { locale } = recipient;
		const { heading, subject, text } = texts(locale);
		return {
			content: {
				button: { label: translate(locale, watch.buttonKey), url },
				heading,
				paragraphs: [translate(locale, 'mail.system.greeting', { name: recipient.name }), text],
			},
			locale,
			subject,
			to: recipient.email,
		};
	};
}

/**
 * Warns about one connection: not past the end of the tick's time budget, not while an earlier
 * try that reached nobody still waits. A failure to write the log is logged, not thrown.
 *
 * @param run The run.
 * @param watch The kind of warning.
 * @param marker The marker so far.
 * @param item The connection and the value it reached.
 * @returns The marker including this warning when it stays claimed.
 */
// oxlint-disable-next-line max-params -- the run, the kind, the marker so far and the pending warning
async function warnOne<Value extends number | string>(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
	watch: Readonly<Watch<Value>>,
	marker: Readonly<Record<string, Value>>,
	item: Readonly<Pending<Value>>,
): Promise<Readonly<Record<string, Value>>> {
	const { connection, value } = item;
	const retryKey = `${watch.key}:${connection.id}`;
	if (run.ctx.now().getTime() >= run.ctx.deadline || (await isWaiting(run, retryKey))) {
		return marker;
	}
	const next = { ...marker, [connection.id]: value };
	const today = todayInClubZone(run.now);
	const texts = (locale: Locale): ReturnType<Watch<Value>['texts']> =>
		watch.texts({ connection, locale, today }, value);
	const claimed = await attempt(async () =>
		deliver(run, {
			action: watch.action,
			details: watch.details(connection, value),
			key: watch.key,
			mail: connectionMail(run, watch, texts, connection),
			next,
			previous: marker,
			retryKey,
			target: `connection:${connection.id}`,
		}),
	);
	return claimed === true ? next : marker;
}

/**
 * Warns about the connections that are pending, one warning after the other: each claims its
 * marker before it sends. Stops at the end of the tick's time budget; the rest comes with the
 * next tick.
 *
 * @param run The run.
 * @param watch The kind of warning.
 * @param state The marker so far and the connections to warn about.
 * @param state.marker The marker so far.
 * @param state.pending The connections to warn about.
 */
async function warnPending<Value extends number | string>(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
	watch: Readonly<Watch<Value>>,
	state: Readonly<{ marker: Readonly<Record<string, Value>>; pending: readonly Pending<Value>[] }>,
): Promise<void> {
	let { marker } = state;
	for (const item of state.pending) {
		// oxlint-disable-next-line no-await-in-loop -- one warning after the other, each claims before it sends
		marker = await warnOne(run, watch, marker, item);
	}
}

/**
 * Warns about the connections whose value reached a new one. First the marker forgets the
 * connections that are quiet again.
 *
 * @param run The run.
 * @param connections The connections.
 * @param watch The kind of warning.
 */
async function warnAbout<Value extends number | string>(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
	connections: readonly Readonly<WatchedConnection>[],
	watch: Readonly<Watch<Value>>,
): Promise<void> {
	const { db } = run.ctx;
	const today = todayInClubZone(run.now);
	const stored = await getState<Record<string, Value>>(db, watch.key);
	const sorted = sortOut(stored, connections, (connection) => watch.valueOf(connection, today));
	if (stored !== null && JSON.stringify(stored) !== JSON.stringify(sorted.marker)) {
		await setState(db, watch.key, sorted.marker);
	}
	await warnPending(run, watch, sorted);
}

/**
 * The text about the days a secret has left.
 *
 * @param locale The language.
 * @param connection The connection.
 * @param today The club's day.
 * @returns The text.
 */
function secretText(
	locale: Locale,
	connection: Readonly<WatchedConnection>,
	today: string,
): string {
	const expiresOn = connection.secretExpiresOn ?? today;
	const days = daysUntil(today, expiresOn);
	const params = { date: formatCalendarDate(expiresOn, locale), days, name: connection.name };
	if (days <= 0) return translate(locale, 'mail.system.sendingSecret.textExpired', params);
	if (days === 1) return translate(locale, 'mail.system.sendingSecret.textTomorrow', params);
	return translate(locale, 'mail.system.sendingSecret.text', params);
}

/** A secret that is about to expire: one warning per stage. */
const secretWatch: Watch<SecretStage> = {
	action: 'sending.secret_warned',
	buttonKey: 'mail.system.sendingSecret.button',
	details: (_connection, stage) => ({ stage }),
	key: 'sending_secret_warned',
	texts: ({ connection, locale, today }) => ({
		heading: translate(locale, 'mail.system.sendingSecret.heading'),
		subject: translate(locale, 'mail.system.sendingSecret.subject', { name: connection.name }),
		text: secretText(locale, connection, today),
	}),
	valueOf: ({ secretExpiresOn }, today) =>
		secretExpiresOn === null ? null : secretWarningStage(secretExpiresOn, today),
};

/** The text of a disturbance by its reason. */
const DISTURBANCE_TEXTS = {
	credentials: 'mail.system.sendingDisturbed.text',
	domain: 'mail.system.sendingDisturbed.textDomain',
	mailbox: 'mail.system.sendingDisturbed.textMailbox',
} as const;

/** A connection the provider refuses: one warning per disturbance, told apart by its start. */
const disturbanceWatch: Watch<string> = {
	action: 'sending.disturbance_warned',
	buttonKey: 'mail.system.sendingDisturbed.button',
	details: (connection) => ({ code: connection.disturbedCode }),
	key: 'sending_disturbance_warned',
	texts: ({ connection, locale }, since) => ({
		heading: translate(locale, 'mail.system.sendingDisturbed.heading'),
		subject: translate(locale, 'mail.system.sendingDisturbed.subject', { name: connection.name }),
		text: translate(locale, DISTURBANCE_TEXTS[disturbanceReason(connection.disturbedCode)], {
			code: connection.disturbedCode ?? 'unknown',
			date: formatClubDate(new Date(since), locale),
			name: connection.name,
		}),
	}),
	valueOf: ({ disturbedSince }) => disturbedSince?.toISOString() ?? null,
};

/** The failed and uncertain entries of one sender since the last digest. */
interface DigestRow {
	readonly email: string | null;
	readonly failed: number;
	readonly uncertain: number;
}

/**
 * Claims the failed and uncertain entries no digest reported yet, by stamping them with the
 * instant of the run, and counts them per sender. An entry counts when it is failed or uncertain,
 * whenever and however it became so (a run, or the sweep of interrupted entries).
 *
 * @param db The database.
 * @param at The instant of the run; it marks the claimed entries.
 * @returns One row per sender, by address; entries of a deleted sender share one row.
 */
async function claimProblems(db: Db, at: Date): Promise<DigestRow[]> {
	const claimed = await db
		.update(outboxEntries)
		.set({ digestedAt: at })
		.where(
			and(inArray(outboxEntries.status, ['failed', 'uncertain']), isNull(outboxEntries.digestedAt)),
		)
		.returning({ senderId: outboxEntries.senderId, status: outboxEntries.status });
	const known = await db.select({ email: senders.email, id: senders.id }).from(senders);
	const addresses = new Map(known.map(({ email, id }) => [id, email]));
	const bySender = new Map<string | null, DigestRow>();
	for (const { senderId, status } of claimed) {
		const email = senderId === null ? null : (addresses.get(senderId) ?? null);
		const row = bySender.get(email) ?? { email, failed: 0, uncertain: 0 };
		bySender.set(
			email,
			status === 'failed'
				? { ...row, failed: row.failed + 1 }
				: { ...row, uncertain: row.uncertain + 1 },
		);
	}
	return [...bySender.values()].toSorted((a, b) => compareCodePoints(a.email ?? '', b.email ?? ''));
}

/**
 * Takes the stamp back from the entries a run claimed, so the next digest reports them.
 *
 * @param db The database.
 * @param at The instant of the run.
 */
async function releaseProblems(db: Db, at: Date): Promise<void> {
	await db.update(outboxEntries).set({ digestedAt: null }).where(eq(outboxEntries.digestedAt, at));
}

/**
 * The mail of the digest: the numbers per sender, no recipient.
 *
 * @param rows The numbers.
 * @param url The link of the button.
 * @returns A function that builds the mail for a recipient.
 */
function digestMail(rows: readonly Readonly<DigestRow>[], url: string): Notice['mail'] {
	const failed = rows.reduce((sum, row) => sum + row.failed, 0);
	const uncertain = rows.reduce((sum, row) => sum + row.uncertain, 0);
	return (recipient) => {
		const { locale } = recipient;
		const lines = rows.map((row) =>
			translate(locale, 'mail.system.sendingDigest.line', {
				failed: row.failed,
				sender: row.email ?? translate(locale, 'mail.system.sendingDigest.unknownSender'),
				uncertain: row.uncertain,
			}),
		);
		return {
			content: {
				button: { label: translate(locale, 'mail.system.sendingDigest.button'), url },
				heading: translate(locale, 'mail.system.sendingDigest.heading'),
				paragraphs: [
					translate(locale, 'mail.system.greeting', { name: recipient.name }),
					translate(locale, 'mail.system.sendingDigest.text', { failed, uncertain }),
					lines.join('\n'),
				],
			},
			locale,
			subject: translate(locale, 'mail.system.sendingDigest.subject'),
			to: recipient.email,
		};
	};
}

/**
 * Sends the digest: at most once a club day, and only when entries failed or became uncertain
 * since the last one. Entries of a day that already had its digest wait for the next day.
 *
 * @param run The run.
 */
async function sendDigest(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
): Promise<void> {
	const { db } = run.ctx;
	const stored = await getState<DigestMarker>(db, 'sending_digest_day');
	const today = todayInClubZone(run.now);
	if (stored?.day === today || (await isWaiting(run, 'digest'))) return;
	const rows = await claimProblems(db, run.now);
	if (rows.length === 0) return;
	await deliver(run, {
		action: 'sending.digest_sent',
		details: {
			failedEntries: rows.reduce((sum, row) => sum + row.failed, 0),
			senders: rows.length,
			uncertainEntries: rows.reduce((sum, row) => sum + row.uncertain, 0),
		},
		key: 'sending_digest_day',
		mail: digestMail(rows, new URL('/admin/sending', run.ctx.env.appUrl).toString()),
		next: { day: today },
		previous: stored,
		retryKey: 'digest',
		undo: async () => releaseProblems(db, run.now),
	});
}

const defaultFetch: typeof fetch = async (input, init) => fetch(input, init);

/**
 * Checks the system sender's token; a failure (the database, a secret that does not decrypt,
 * which disturbs the connection) is logged by its code and does not stop the warnings.
 *
 * @param ctx The tick's context.
 * @param fetchFn The `fetch` of the token request.
 */
async function checkSystemSenderSafely(ctx: TickContext, fetchFn: typeof fetch): Promise<void> {
	try {
		await checkSystemSender(ctx.db, ctx.env, { fetch: fetchFn, now: ctx.now });
	} catch (error) {
		// oxlint-disable-next-line no-console -- the code only
		console.error('system sender check failed', errorLabel(error));
	}
}

/**
 * Builds the tick step that warns the admins about the senders.
 *
 * @param createMailer Makes the mailer from the tick's context; tests pass a capturing one.
 * @param fetchFn The `fetch` of the system sender's token check; tests pass a fake provider.
 * @returns The `sending-warnings` step.
 */
function createSendingWarningsStep(
	createMailer: (ctx: TickContext) => SystemMailer = tickMailer,
	fetchFn: typeof fetch = defaultFetch,
): TickStep {
	return {
		name: 'sending-warnings',
		async run(ctx) {
			await checkSystemSenderSafely(ctx, fetchFn);
			let admins: Promise<readonly Recipient[]> | null = null;
			const run: Run = {
				admins: async () => {
					admins ??= activeAdmins(ctx.db);
					return admins;
				},
				ctx,
				mailer: createMailer(ctx),
				now: ctx.now(),
			};
			const connections = await watchedConnections(ctx.db);
			await warnAbout(run, connections, secretWatch);
			await warnAbout(run, connections, disturbanceWatch);
			if (ctx.now().getTime() >= ctx.deadline) return { moreWork: true };
			await attempt(async () => sendDigest(run));
			return { moreWork: false };
		},
	};
}

const sendingWarnings = createSendingWarningsStep();

export {
	SECRET_WARNING_DAYS,
	createSendingWarningsStep,
	secretWarningStage,
	sendingNotice,
	sendingWarnings,
};
export type { SecretStage, SendingNotice };
