import { createTransport } from 'nodemailer';

import type { SystemMail } from './system-mailer';

interface SmtpTransport {
	sendMail: (mail: Readonly<SystemMail & { from: string }>) => Promise<unknown>;
}

/**
 * Opens an SMTP transport. Kept in its own module so only the Node path ever loads `nodemailer`,
 * see `createSystemMailer`.
 *
 * @param smtpUrl The `smtp://` URL of the server.
 * @returns The transport.
 */
function openSmtpTransport(smtpUrl: string): SmtpTransport {
	return createTransport(smtpUrl);
}

export { openSmtpTransport };
export type { SmtpTransport };
