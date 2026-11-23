import { t } from '../../i18n/t';
import type { Env } from '../env';
import type { SmtpTransport } from './smtp-transport';

/** A mail the app itself sends, such as a login link or an invitation. */
interface SystemMail {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

interface SystemMailer {
	send: (mail: Readonly<SystemMail>) => Promise<void>;
}

/** No transport is set up for system mails. The message names no setting value. */
class MailerNotConfiguredError extends Error {
	public constructor() {
		super('No transport for system mails is configured.');
		this.name = 'MailerNotConfiguredError';
	}
}

const notConfiguredMailer: SystemMailer = {
	// oxlint-disable-next-line typescript/require-await -- the interface is async, this mailer rejects at once
	async send() {
		throw new MailerNotConfiguredError();
	},
};

/**
 * Loads the SMTP module and opens a transport. Only the Node path reaches this dynamic import,
 * see `createSystemMailer`.
 *
 * @param smtpUrl The `smtp://` URL of the server.
 * @returns The transport.
 */
async function openTransport(smtpUrl: string): Promise<SmtpTransport> {
	const { openSmtpTransport } = await import('./smtp-transport');
	return openSmtpTransport(smtpUrl);
}

/**
 * Sends via SMTP (Mailpit in development). The transport is opened on the first send.
 *
 * @param smtpUrl The `smtp://` URL of the server.
 * @param from The sender address.
 * @returns The mailer.
 */
function createSmtpMailer(smtpUrl: string, from: string): SystemMailer {
	const opened: { transport?: Promise<SmtpTransport> } = {};
	return {
		async send(mail) {
			opened.transport ??= openTransport(smtpUrl);
			const transport = await opened.transport;
			await transport.sendMail({ ...mail, from });
		},
	};
}

/**
 * Returns the mailer for system mails. With `DEV_SMTP_URL` it sends via SMTP, otherwise it
 * throws `MailerNotConfiguredError`. Cloudflare and Vercel get no SMTP transport: the platform is
 * the build constant, so the SMTP branch is removed from those bundles.
 *
 * @param env The validated environment.
 * @returns The mailer.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Env holds a URL and a Uint8Array, which cannot be readonly
function createSystemMailer(env: Readonly<Env>): SystemMailer {
	if (
		import.meta.env.VITE_VB_PLATFORM !== 'cloudflare' &&
		import.meta.env.VITE_VB_PLATFORM !== 'vercel' &&
		env.devSmtpUrl !== null
	) {
		return createSmtpMailer(env.devSmtpUrl, `${t('app.name')} <noreply@${env.appUrl.hostname}>`);
	}
	return notConfiguredMailer;
}

export { MailerNotConfiguredError, createSystemMailer };
export type { SystemMail, SystemMailer };
