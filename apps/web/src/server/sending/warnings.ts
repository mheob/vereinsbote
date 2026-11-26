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
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { formatCalendarDate, formatClubDate, todayInClubZone } from '@/server/contacts/calendar';
import { activeAdmins, tickMailer } from '@/server/contacts/stale-import';
import type { Recipient } from '@/server/contacts/stale-import';
import type { Db } from '@/server/db/client';
import { mailConnections, outboxEntries, senders } from '@/server/db/schema';
import { errorLabel } from '@/server/error-label';
import type { SystemMail, SystemMailer } from '@/server/mail/system-mailer';
import { clearState, getState, setState } from '@/server/system-state';
import type { StateKey } from '@/server/system-state';
import type { TickContext, TickStep } from '@/server/tick/tick';

/** The days before the expiry of a secret at which the admins are warned, once each. */
// oxlint-disable-next-line no-magic-numbers -- the stages are the point of the list
const SECRET_WARNING_DAYS = [30, 14, 7, 1] as const;

type SecretStage = (typeof SECRET_WARNING_DAYS)[number];

const MS_PER_DAY = 86_400_000;

/** The club day of the last digest and the instant up to which it counted. */
interface DigestMarker {
	readonly day: string;
	readonly at: string;
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
	const days = Math.round((Date.parse(expiresOn) - Date.parse(today)) / MS_PER_DAY);
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

/**
 * Claims a warning, sends it and logs it. A log entry that fails gives the claim back and throws.
 *
 * @param run The run.
 * @param notice The warning.
 */
async function deliver(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see Run
	run: Readonly<Run>,
	notice: Readonly<Notice>,
): Promise<void> {
	const { db } = run.ctx;
	await setState(db, notice.key, notice.next);
	const outcome = await mailAll(run, await run.admins(), notice.mail);
	try {
		await writeAudit(db, {
			action: notice.action,
			actorUserId: null,
			details: { ...notice.details, ...outcome },
			target: notice.target,
		});
	} catch (error) {
		// Without its log entry the warning does not count: the next tick tries again.
		await (notice.previous === null
			? clearState(db, notice.key)
			: setState(db, notice.key, notice.previous));
		throw error;
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
	const today = todayInClubZone(run.now);
	let { marker } = state;
	for (const { connection, value } of state.pending) {
		if (run.ctx.now().getTime() < run.ctx.deadline) {
			const next = { ...marker, [connection.id]: value };
			const texts = (locale: Locale): ReturnType<Watch<Value>['texts']> =>
				watch.texts({ connection, locale, today }, value);
			// oxlint-disable-next-line no-await-in-loop -- one warning after the other, each claims before it sends
			await deliver(run, {
				action: watch.action,
				details: watch.details(connection, value),
				key: watch.key,
				mail: connectionMail(run, watch, texts, connection),
				next,
				previous: marker,
				target: `connection:${connection.id}`,
			});
			marker = next;
		}
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
	const days = Math.round((Date.parse(expiresOn) - Date.parse(today)) / MS_PER_DAY);
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

/** A connection the provider refuses: one warning per disturbance, told apart by its start. */
const disturbanceWatch: Watch<string> = {
	action: 'sending.disturbance_warned',
	buttonKey: 'mail.system.sendingDisturbed.button',
	details: (connection) => ({ code: connection.disturbedCode }),
	key: 'sending_disturbance_warned',
	texts: ({ connection, locale }, since) => ({
		heading: translate(locale, 'mail.system.sendingDisturbed.heading'),
		subject: translate(locale, 'mail.system.sendingDisturbed.subject', { name: connection.name }),
		text: translate(locale, 'mail.system.sendingDisturbed.text', {
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
 * Counts the failed and uncertain entries per sender since an instant. An entry counts from the
 * moment a run claimed it (from its creation when none did).
 *
 * @param db The database.
 * @param since The end of the last digest, or null for all.
 * @returns One row per sender, by address; entries of a deleted sender share one row.
 */
async function countProblems(db: Db, since: Date | null): Promise<DigestRow[]> {
	const stamp = sql`coalesce(${outboxEntries.claimedAt}, ${outboxEntries.createdAt})`;
	return db
		.select({
			email: senders.email,
			failed: sql<number>`count(*) filter (where ${outboxEntries.status} = 'failed')`.mapWith(
				Number,
			),
			uncertain: sql<number>`count(*) filter (where ${outboxEntries.status} = 'uncertain')`.mapWith(
				Number,
			),
		})
		.from(outboxEntries)
		.leftJoin(senders, eq(senders.id, outboxEntries.senderId))
		.where(
			and(
				inArray(outboxEntries.status, ['failed', 'uncertain']),
				since === null ? undefined : sql`${stamp} > ${since.toISOString()}::timestamptz`,
			),
		)
		.groupBy(senders.email)
		.orderBy(senders.email);
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
	if (stored?.day === today) return;
	const rows = await countProblems(db, stored === null ? null : new Date(stored.at));
	if (rows.length === 0) return;
	const next: DigestMarker = { at: run.now.toISOString(), day: today };
	await deliver(run, {
		action: 'sending.digest_sent',
		details: {
			failedEntries: rows.reduce((sum, row) => sum + row.failed, 0),
			senders: rows.length,
			uncertainEntries: rows.reduce((sum, row) => sum + row.uncertain, 0),
		},
		key: 'sending_digest_day',
		mail: digestMail(rows, new URL('/admin/sending', run.ctx.env.appUrl).toString()),
		next,
		previous: stored,
	});
}

/**
 * Builds the tick step that warns the admins about the senders.
 *
 * @param createMailer Makes the mailer from the tick's context; tests pass a capturing one.
 * @returns The `sending-warnings` step.
 */
function createSendingWarningsStep(
	createMailer: (ctx: TickContext) => SystemMailer = tickMailer,
): TickStep {
	return {
		name: 'sending-warnings',
		async run(ctx) {
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
			await sendDigest(run);
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
