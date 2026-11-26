/* oxlint-disable max-classes-per-file -- both errors of the system mailer live with it */
/*
 * The mailer of the system mails: login links, invitations, warnings (Design 14). With a system
 * sender a mail goes straight through its transport, not through the outbox, so a login link does
 * not wait for the next tick: Graph as JSON without a copy in "Sent Items", Resend without the
 * archive copy, no unsubscribe header. It counts against the daily limit of the sender (Graph) or
 * the connection (Resend) but is never held back by it (Design 8.3). Without a system sender it
 * goes through `DEV_SMTP_URL` on the Node path (development), else it fails with
 * `MailerNotConfiguredError`.
 *
 * A send has two halves. `prepare` does all the database work (the system sender, its decrypted
 * credentials, the brand, the count) and returns the delivery, which renders the mail and calls
 * the provider without touching the database. On Cloudflare the request's database ends with the
 * response, and a login link is delivered after it (`createLinkSender`).
 *
 * A broken system sender must not stay unnoticed (Design 8.6): a secret that does not decrypt, and
 * a refusal of the credentials, the mailbox or the domain when `send` runs (invitations, warnings,
 * in a request or a tick), mark its connection disturbed like the outbox does. A login link
 * delivered after the response cannot; `checkSystemSender`, run by every tick, fetches a Graph
 * token instead.
 */
import { eq } from 'drizzle-orm';

import { DEFAULT_LOCALE } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { cleanHeaderText } from '@/mail/escape';
import { getBrand } from '@/server/brand/brand';
import type { BrandState } from '@/server/brand/brand';
import { SecretDecryptError } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { mailConnections, senders } from '@/server/db/schema';
import type { Env } from '@/server/env';
import type { SmtpMail, SmtpTransport } from '@/server/mail/smtp-transport';

import { disturbanceReason } from './disturbance';
import { openSenderTransport } from './open-transport';
import type { SenderTransport } from './open-transport';
import { clearDisturbance, disturbConnection } from './outbox';
import { countNothing, countSent } from './quota';
import { composeSystemMail } from './system-mail';
import type { SystemMailContent } from './system-mail';
import { newMessageId } from './transport';

/** A mail the app itself sends, in the recipient's language. */
interface SystemMail {
	/** The normalized address. */
	readonly to: string;
	readonly locale: Locale;
	readonly subject: string;
	readonly content: SystemMailContent;
}

/**
 * What is left of a system mail once its database work is done: rendering it and handing it to
 * the provider. It needs no database, so it may run after the response.
 */
type SystemMailDelivery = () => Promise<void>;

interface SystemMailer {
	/** Sends a mail; resolves once the provider took it and throws when it did not. */
	readonly send: (mail: Readonly<SystemMail>) => Promise<void>;
	/**
	 * Does the database work of a mail now and returns its delivery. Without a mail it runs the
	 * same statements, counts nothing and returns null, so a request runs the same statements
	 * whether or not a mail goes out.
	 */
	readonly prepare: (mail: Readonly<SystemMail> | null) => Promise<SystemMailDelivery | null>;
}

interface SystemMailerDeps {
	readonly env: Env;
	readonly db: Db;
	/** Default: the global `fetch`. */
	readonly fetch?: typeof fetch;
	/** Default: the system clock. */
	readonly now?: () => Date;
}

/** No transport is set up for system mails. The message names no setting value. */
class MailerNotConfiguredError extends Error {
	public constructor() {
		super('No transport for system mails is configured.');
		this.name = 'MailerNotConfiguredError';
	}
}

/**
 * The provider did not take a system mail; `code` is its failure code, e.g. `graph.unauthorized`,
 * `refusedAccess` whether it refused the credentials, the mailbox or the domain.
 */
class SystemMailNotSentError extends Error {
	public readonly code: string;
	public readonly refusedAccess: boolean;

	public constructor(code: string, refusedAccess = false) {
		super('The provider did not take the system mail.');
		this.name = 'SystemMailNotSentError';
		this.code = code;
		this.refusedAccess = refusedAccess;
	}
}

/** Sends a finished mail through `DEV_SMTP_URL`. */
type SmtpSend = (
	mail: Readonly<Pick<SmtpMail, 'html' | 'subject' | 'text' | 'to'>>,
) => Promise<void>;

/** The sender that sends the system mails and its connection. */
interface SystemSender {
	readonly id: string;
	readonly connectionId: string;
}

/**
 * The sender that sends the system mails.
 *
 * @param db The database.
 * @returns It and its connection, or null when none is chosen.
 */
async function systemSender(db: Db): Promise<SystemSender | null> {
	const [row] = await db
		.select({ connectionId: senders.connectionId, id: senders.id })
		.from(senders)
		.where(eq(senders.isSystem, true))
		.limit(1);
	return row ?? null;
}

/**
 * Tells whether a sender is chosen for the system mails.
 *
 * @param db The database.
 * @returns True when one is.
 */
async function hasSystemSender(db: Db): Promise<boolean> {
	return (await systemSender(db)) !== null;
}

type OpenDeps = Readonly<{ fetch: typeof fetch; now: () => Date }>;

/**
 * Opens the transport of the system sender. A secret that does not decrypt (another app secret)
 * disturbs the connection, like in the outbox, and the error goes on.
 *
 * @param db The database.
 * @param env The environment.
 * @param sender The system sender.
 * @param deps `fetch` and the clock.
 * @returns The transport.
 * @throws {SecretDecryptError} When the secret does not decrypt.
 */
// oxlint-disable-next-line max-params -- the database, the environment, the sender and the deps
async function openSystemTransport(
	db: Db,
	env: Env,
	sender: Readonly<SystemSender>,
	deps: OpenDeps,
): Promise<SenderTransport> {
	try {
		return await openSenderTransport(db, env, sender.id, deps);
	} catch (error) {
		if (error instanceof SecretDecryptError) {
			await disturbConnection(db, sender.connectionId, 'outbox.credentials', deps.now());
		}
		throw error;
	}
}

/**
 * Loads the SMTP module and opens a transport. Only the Node path reaches this dynamic import,
 * see `smtpSend`.
 *
 * @param smtpUrl The `smtp://` URL of the server.
 * @returns The transport.
 */
async function openSmtp(smtpUrl: string): Promise<SmtpTransport> {
	const { openSmtpTransport } = await import('@/server/mail/smtp-transport');
	return openSmtpTransport(smtpUrl);
}

/**
 * Sending through `DEV_SMTP_URL` (Mailpit in development), opened on the first mail. Cloudflare
 * and Vercel get none: the platform is the build constant, so the branch and with it the SMTP
 * module are removed from those bundles.
 *
 * @param env The environment.
 * @returns The send function, or null without SMTP.
 */
function smtpSend(env: Env): SmtpSend | null {
	if (
		import.meta.env.VITE_VB_PLATFORM !== 'cloudflare' &&
		import.meta.env.VITE_VB_PLATFORM !== 'vercel' &&
		env.devSmtpUrl !== null
	) {
		const smtpUrl = env.devSmtpUrl;
		// The sender name is the app name, the same in every language.
		const from = `${translate(DEFAULT_LOCALE, 'app.name')} <noreply@${env.appUrl.hostname}>`;
		const opened: { transport?: Promise<SmtpTransport> } = {};
		return async (mail) => {
			opened.transport ??= openSmtp(smtpUrl);
			const transport = await opened.transport;
			await transport.sendMail({ ...mail, from });
		};
	}
	return null;
}

/**
 * Renders a mail for the recipient.
 *
 * @param mail The mail.
 * @param brand The brand.
 * @param env The environment (the origin of the app).
 * @returns The subject, the HTML and the text.
 */
async function render(
	mail: Readonly<SystemMail>,
	brand: Readonly<BrandState>,
	env: Env,
): Promise<{ subject: string; html: string; text: string }> {
	const { html, text } = await composeSystemMail(
		mail.content,
		mail.subject,
		brand,
		env.appUrl.origin,
		mail.locale,
	);
	return { html, subject: cleanHeaderText(mail.subject), text };
}

/**
 * Hands a rendered mail to the system sender's transport.
 *
 * @param opened The transport of the system sender.
 * @param mail The mail.
 * @param rendered The subject, the HTML and the text.
 * @throws {SystemMailNotSentError} When the provider does not take it.
 */
async function sendThrough(
	opened: SenderTransport,
	mail: Readonly<SystemMail>,
	rendered: Readonly<{ subject: string; html: string; text: string }>,
): Promise<void> {
	const { sender, transport } = opened;
	const result = await transport.send({
		...rendered,
		attachments: [],
		bcc: null,
		from: { address: sender.email, name: sender.displayName },
		idempotencyKey: crypto.randomUUID(),
		kind: 'system',
		listUnsubscribe: null,
		messageId: newMessageId(sender.email),
		replyTo: sender.replyTo,
		to: mail.to,
	});
	if (!result.ok) throw new SystemMailNotSentError(result.code, result.failure === 'unauthorized');
}

/** What a mailer works with: the database, the environment, `fetch`, the clock and SMTP. */
interface MailerContext {
	readonly db: Db;
	readonly env: Env;
	readonly fetch: typeof fetch;
	readonly now: () => Date;
	readonly smtp: SmtpSend | null;
}

/** The delivery of a mail, and the connection that sends it (null without a system sender). */
interface Opening {
	readonly delivery: SystemMailDelivery | null;
	readonly connectionId: string | null;
}

const NOTHING_TO_DELIVER: Opening = { connectionId: null, delivery: null };

/**
 * The database work of a mail without a system sender: `DEV_SMTP_URL`, or none at all.
 *
 * @param ctx The mailer's context.
 * @param mail The mail, or null to run the statements only.
 * @returns The delivery through SMTP.
 * @throws {MailerNotConfiguredError} For a mail without SMTP.
 */
async function openViaSmtp(
	ctx: Readonly<MailerContext>,
	mail: Readonly<SystemMail> | null,
): Promise<Opening> {
	const { smtp } = ctx;
	if (smtp === null) {
		if (mail === null) return NOTHING_TO_DELIVER;
		throw new MailerNotConfiguredError();
	}
	const brand = await getBrand(ctx.db);
	if (mail === null) return NOTHING_TO_DELIVER;
	const delivery = async (): Promise<void> =>
		smtp({ ...(await render(mail, brand, ctx.env)), to: mail.to });
	return { connectionId: null, delivery };
}

/**
 * The database work of a mail through the system sender: its transport, the brand and the count.
 *
 * @param ctx The mailer's context.
 * @param sender The system sender.
 * @param mail The mail, or null to run the statements only.
 * @returns The delivery through the sender's transport, and its connection.
 */
async function openViaSender(
	ctx: Readonly<MailerContext>,
	sender: Readonly<SystemSender>,
	mail: Readonly<SystemMail> | null,
): Promise<Opening> {
	const { db, env, now } = ctx;
	const [opened, brand] = await Promise.all([
		openSystemTransport(db, env, sender, { fetch: ctx.fetch, now }),
		getBrand(db),
	]);
	// Counted before the delivery, which may run after the database has ended; a mail the
	// provider then refuses still counts.
	await (mail === null ? countNothing : countSent)(db, opened.scope, now());
	const { connectionId } = sender;
	if (mail === null) return { connectionId, delivery: null };
	const delivery = async (): Promise<void> =>
		sendThrough(opened, mail, await render(mail, brand, env));
	return { connectionId, delivery };
}

/**
 * The database work of a mail: the same statements with and without one.
 *
 * @param ctx The mailer's context.
 * @param mail The mail, or null to run the statements only.
 * @returns The delivery and the connection that sends it.
 */
async function openMail(
	ctx: Readonly<MailerContext>,
	mail: Readonly<SystemMail> | null,
): Promise<Opening> {
	const sender = await systemSender(ctx.db);
	return sender === null ? openViaSmtp(ctx, mail) : openViaSender(ctx, sender, mail);
}

/**
 * Delivers a mail while the database still runs (a request or a tick); a refusal of the
 * credentials, the mailbox or the domain marks the connection disturbed, so the admins learn of it.
 *
 * @param ctx The mailer's context.
 * @param opening The delivery and its connection.
 * @throws {SystemMailNotSentError} When the provider did not take the mail.
 */
async function deliverNoting(
	ctx: Readonly<MailerContext>,
	opening: Readonly<Opening>,
): Promise<void> {
	try {
		await opening.delivery?.();
	} catch (error) {
		const { connectionId } = opening;
		if (error instanceof SystemMailNotSentError && error.refusedAccess && connectionId !== null) {
			await disturbConnection(ctx.db, connectionId, error.code, ctx.now());
		}
		throw error;
	}
}

/**
 * Creates the mailer of the system mails. It reads the system sender on every mail, so a choice
 * of the admin counts at once. On Cloudflare the database is the request's, so the mailer is made
 * per request, together with the auth instance (plan decision 12).
 *
 * @param deps The environment, the database, `fetch` and the clock.
 * @returns The mailer.
 */
function createSystemMailer(deps: SystemMailerDeps): SystemMailer {
	const ctx: MailerContext = {
		db: deps.db,
		env: deps.env,
		fetch: deps.fetch ?? (async (input, init) => fetch(input, init)),
		now: deps.now ?? ((): Date => new Date()),
		smtp: smtpSend(deps.env),
	};
	return {
		async prepare(mail) {
			const { delivery } = await openMail(ctx, mail);
			return delivery;
		},
		async send(mail) {
			await deliverNoting(ctx, await openMail(ctx, mail));
		},
	};
}

/**
 * The connection of the system sender when a token can tell about it: not while a refused
 * mailbox or domain disturbs it, which a token cannot disprove.
 *
 * @param db The database.
 * @param sender The system sender.
 * @returns When its disturbance began (null: none) and its code, or null when a token cannot tell.
 */
async function tokenCheckable(
	db: Db,
	sender: Readonly<SystemSender>,
): Promise<{ since: Date | null; code: string | null } | null> {
	const [connection] = await db
		.select({ code: mailConnections.disturbedCode, since: mailConnections.disturbedSince })
		.from(mailConnections)
		.where(eq(mailConnections.id, sender.connectionId));
	if (connection === undefined) return null;
	const refusedMailbox =
		connection.since !== null && disturbanceReason(connection.code) !== 'credentials';
	return refusedMailbox ? null : connection;
}

/**
 * Checks the credentials of the system sender's Graph connection by fetching a token, once per
 * tick (`sendingWarnings`): a refused token marks the connection disturbed, a token ends a
 * disturbance of its credentials. A refused mailbox stays: a token says nothing about it. Resend
 * has no token to fetch; its refusals show when `send` runs. This is the only way a refused login
 * link delivered after the response (Cloudflare) comes to light.
 *
 * @param db The database.
 * @param env The environment.
 * @param deps `fetch` and the clock.
 * @throws {SecretDecryptError} When the secret does not decrypt; the connection is disturbed then.
 */
async function checkSystemSender(db: Db, env: Env, deps: OpenDeps): Promise<void> {
	const sender = await systemSender(db);
	const connection = sender === null ? null : await tokenCheckable(db, sender);
	if (sender === null || connection === null) return;
	const { transport } = await openSystemTransport(db, env, sender, deps);
	if (transport.probe === null) return;
	const probed = await transport.probe();
	if (probed.ok && connection.since !== null) {
		await clearDisturbance(db, sender.connectionId, {
			code: connection.code,
			since: connection.since,
		});
	}
	if (!probed.ok && probed.failure === 'unauthorized') {
		await disturbConnection(db, sender.connectionId, probed.code, deps.now());
	}
}

export {
	MailerNotConfiguredError,
	SystemMailNotSentError,
	checkSystemSender,
	createSystemMailer,
	hasSystemSender,
};
export type { SystemMail, SystemMailDelivery, SystemMailer, SystemMailerDeps };
