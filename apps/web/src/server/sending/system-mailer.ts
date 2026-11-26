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
 */
import { eq } from 'drizzle-orm';

import { DEFAULT_LOCALE } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { cleanHeaderText } from '@/mail/escape';
import { getBrand } from '@/server/brand/brand';
import type { BrandState } from '@/server/brand/brand';
import type { Db } from '@/server/db/client';
import { senders } from '@/server/db/schema';
import type { Env } from '@/server/env';
import type { SmtpMail, SmtpTransport } from '@/server/mail/smtp-transport';

import { openSenderTransport } from './open-transport';
import type { SenderTransport } from './open-transport';
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

/** The provider did not take a system mail; `code` is its failure code, e.g. `graph.unauthorized`. */
class SystemMailNotSentError extends Error {
	public readonly code: string;

	public constructor(code: string) {
		super('The provider did not take the system mail.');
		this.name = 'SystemMailNotSentError';
		this.code = code;
	}
}

/** Sends a finished mail through `DEV_SMTP_URL`. */
type SmtpSend = (
	mail: Readonly<Pick<SmtpMail, 'html' | 'subject' | 'text' | 'to'>>,
) => Promise<void>;

/**
 * The sender that sends the system mails.
 *
 * @param db The database.
 * @returns Its id, or null when none is chosen.
 */
async function systemSenderId(db: Db): Promise<string | null> {
	const [row] = await db
		.select({ id: senders.id })
		.from(senders)
		.where(eq(senders.isSystem, true))
		.limit(1);
	return row?.id ?? null;
}

/**
 * Tells whether a sender is chosen for the system mails.
 *
 * @param db The database.
 * @returns True when one is.
 */
async function hasSystemSender(db: Db): Promise<boolean> {
	return (await systemSenderId(db)) !== null;
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
	if (!result.ok) throw new SystemMailNotSentError(result.code);
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
	const { db, env } = deps;
	const fetchFn: typeof fetch = deps.fetch ?? (async (input, init) => fetch(input, init));
	const now = deps.now ?? ((): Date => new Date());
	const smtp = smtpSend(env);

	const prepare: SystemMailer['prepare'] = async (mail) => {
		const senderId = await systemSenderId(db);
		if (senderId === null) {
			if (smtp === null) {
				if (mail === null) return null;
				throw new MailerNotConfiguredError();
			}
			const brand = await getBrand(db);
			return mail === null
				? null
				: async () => smtp({ ...(await render(mail, brand, env)), to: mail.to });
		}
		const [opened, brand] = await Promise.all([
			openSenderTransport(db, env, senderId, { fetch: fetchFn, now }),
			getBrand(db),
		]);
		// Counted before the delivery, which may run after the database has ended; a mail the
		// provider then refuses still counts.
		await (mail === null ? countNothing : countSent)(db, opened.scope, now());
		return mail === null
			? null
			: async () => sendThrough(opened, mail, await render(mail, brand, env));
	};

	return {
		prepare,
		async send(mail) {
			const delivery = await prepare(mail);
			await delivery?.();
		},
	};
}

export { MailerNotConfiguredError, SystemMailNotSentError, createSystemMailer, hasSystemSender };
export type { SystemMail, SystemMailDelivery, SystemMailer, SystemMailerDeps };
