import { and, eq, sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { systemState, user } from '@/server/db/schema';
import { errorLabel } from '@/server/error-label';
import { createSystemMailer } from '@/server/mail/system-mailer';
import type { SystemMailer } from '@/server/mail/system-mailer';
import { clearState, getState, setState } from '@/server/system-state';
import type { TickContext, TickStep } from '@/server/tick/tick';

import { formatClubDate } from './calendar';
import { getImportState } from './import-state';
import { getContactSettings } from './settings';

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
const WEEK_MS = DAYS_PER_WEEK * MS_PER_DAY;

/** The warning goes out at most once in this time. */
const STALE_WARNING_INTERVAL_MS = WEEK_MS;

/** How old the last member import is, judged against the configured weeks. */
interface ImportFreshness {
	/** When the last member import was confirmed; null before the first one. */
	lastImportAt: Date | null;
	/** True when the last import is older than `weeks`; never before the first import. */
	stale: boolean;
	weeks: number;
}

/**
 * Tells whether the member data is old.
 *
 * @param db The database.
 * @param now The instant to judge at.
 * @returns The last import, the weeks and whether the data is stale.
 */
async function getImportFreshness(db: Db, now: Date): Promise<ImportFreshness> {
	const [settings, state] = await Promise.all([
		getContactSettings(db),
		getImportState(db, 'member'),
	]);
	const { lastConfirmedAt } = state;
	const { staleImportWeeks: weeks } = settings;
	const stale =
		lastConfirmedAt !== null && lastConfirmedAt.getTime() + weeks * WEEK_MS < now.getTime();
	return { lastImportAt: lastConfirmedAt, stale, weeks };
}

/**
 * Claims the weekly warning: one atomic upsert that succeeds only when no warning was recorded
 * or the last one is at least a week old. The clock is the tick's, so tests can move it.
 *
 * @param db The database.
 * @param now The tick's instant.
 * @returns True when this run owns the warning of the week.
 */
async function claimWeek(db: Db, now: Date): Promise<boolean> {
	const claimed = await db
		.insert(systemState)
		.values({ key: 'stale_import_warned_at', value: { at: now.toISOString() } })
		.onConflictDoUpdate({
			set: { updatedAt: sql`now()`, value: sql`excluded.value` },
			// A value without a readable time counts as old.
			setWhere: sql`coalesce((${systemState.value}->>'at')::timestamptz, '-infinity') <= ${new Date(now.getTime() - STALE_WARNING_INTERVAL_MS).toISOString()}::timestamptz`,
			target: systemState.key,
		})
		.returning({ key: systemState.key });
	return claimed.length > 0;
}

/**
 * Gives the week back after the audit entry failed, so the next tick warns again: the earlier
 * claim returns, or the row goes when there was none.
 *
 * @param db The database.
 * @param previous The value the claim replaced, or null.
 */
async function releaseWeek(db: Db, previous: unknown): Promise<void> {
	await (previous === null
		? clearState(db, 'stale_import_warned_at')
		: setState(db, 'stale_import_warned_at', previous));
}

/** An active admin who gets the warning. */
interface Recipient {
	email: string;
	locale: Locale;
	name: string;
}

/**
 * The active admins, who get the warnings of the system.
 *
 * @param db The database.
 * @returns Their addresses, languages and names, by address.
 */
async function activeAdmins(db: Db): Promise<Recipient[]> {
	return db
		.select({ email: user.email, locale: user.locale, name: user.name })
		.from(user)
		.where(and(eq(user.isAdmin, true), eq(user.status, 'active')))
		.orderBy(user.email);
}

/** What the mails of one run came to. */
interface SendOutcome {
	sent: number;
	failed: number;
	error?: string;
}

/** What every mail of one run shares. */
interface WarningContext {
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the mailer is a behavior, not data
	mailer: SystemMailer;
	link: string;
	lastImportAt: Date;
}

async function sendWarning(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see WarningContext
	shared: WarningContext,
	recipient: Readonly<Recipient>,
): Promise<void> {
	const { locale } = recipient;
	const date = formatClubDate(shared.lastImportAt, locale);
	await shared.mailer.send({
		content: {
			button: { label: translate(locale, 'mail.system.staleImport.button'), url: shared.link },
			heading: translate(locale, 'mail.system.staleImport.heading'),
			paragraphs: [
				translate(locale, 'mail.system.greeting', { name: recipient.name }),
				translate(locale, 'mail.system.staleImport.text', { date }),
			],
		},
		locale,
		subject: translate(locale, 'mail.system.staleImport.subject'),
		to: recipient.email,
	});
}

/**
 * Mails every recipient; a failure is counted and logged by its code only, never by address.
 *
 * @param shared The mailer, the link and the date of the last import.
 * @param recipients Who gets it.
 * @returns How many mails went out, how many failed and the code of the last failure.
 */
async function sendWarnings(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see WarningContext
	shared: WarningContext,
	recipients: readonly Readonly<Recipient>[],
): Promise<SendOutcome> {
	const outcome: SendOutcome = { failed: 0, sent: 0 };
	for (const recipient of recipients) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- one mail after the other, a failure must not stop the rest
			await sendWarning(shared, recipient);
			outcome.sent += 1;
		} catch (error) {
			outcome.failed += 1;
			outcome.error = errorLabel(error);
			// oxlint-disable-next-line no-console -- the code only, never the address
			console.error('stale import warning failed', outcome.error);
		}
	}
	return outcome;
}

/**
 * Writes the activity log entry of the warning. When that fails, the week is given back and the
 * error goes on: without its log entry the warning does not count, the next tick tries again.
 *
 * @param db The database.
 * @param outcome What the mails came to.
 * @param previous The value the claim of the week replaced, or null.
 */
async function logWarning(
	db: Db,
	outcome: Readonly<SendOutcome>,
	previous: unknown,
): Promise<void> {
	try {
		await writeAudit(db, {
			action: 'import.stale_warning',
			actorUserId: null,
			details: { ...outcome },
		});
	} catch (error) {
		await releaseWeek(db, previous);
		throw error;
	}
}

/**
 * The system mailer of a tick: the tick's database, environment and clock.
 *
 * @param ctx The context of the tick.
 * @returns The mailer.
 */
function tickMailer(ctx: TickContext): SystemMailer {
	return createSystemMailer({ db: ctx.db, env: ctx.env, now: ctx.now });
}

/**
 * Builds the tick step that warns the active admins once a week while the member data is old.
 * The week is claimed before sending: a failed mail is not retried before the next week.
 *
 * @param createMailer Makes the mailer from the tick's context; tests pass a capturing one.
 * @returns The `stale-import-warning` step.
 */
function createStaleImportWarningStep(
	createMailer: (ctx: TickContext) => SystemMailer = tickMailer,
): TickStep {
	return {
		name: 'stale-import-warning',
		async run(ctx) {
			const now = ctx.now();
			const freshness = await getImportFreshness(ctx.db, now);
			if (!freshness.stale || freshness.lastImportAt === null) return { moreWork: false };
			const previous = await getState<unknown>(ctx.db, 'stale_import_warned_at');
			if (!(await claimWeek(ctx.db, now))) return { moreWork: false };
			const recipients = await activeAdmins(ctx.db);
			const outcome = await sendWarnings(
				{
					lastImportAt: freshness.lastImportAt,
					link: new URL('/contacts/import/members', ctx.env.appUrl).toString(),
					mailer: createMailer(ctx),
				},
				recipients,
			);
			await logWarning(ctx.db, outcome, previous);
			return { moreWork: false };
		},
	};
}

const staleImportWarning = createStaleImportWarningStep();

export {
	STALE_WARNING_INTERVAL_MS,
	activeAdmins,
	createStaleImportWarningStep,
	getImportFreshness,
	staleImportWarning,
	tickMailer,
};
export type { ImportFreshness, Recipient };
