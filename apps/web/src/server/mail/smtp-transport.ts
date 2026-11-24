import { createTransport } from 'nodemailer';

import type { SystemMail } from './system-mailer';

interface SmtpTransport {
	sendMail: (mail: Readonly<SystemMail & { from: string }>) => Promise<unknown>;
}

interface SmtpTransportOptions {
	host: string;
	/** Unset: nodemailer's default port. */
	port?: number;
	requireTLS: boolean;
	auth?: { user: string; pass: string };
}

/** Hosts on the local machine; Mailpit in development listens there (`docker/compose.dev.yml`). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Reads the connection settings from an `smtp://` URL. Mail goes unencrypted only to the local
 * machine; any other server must upgrade the connection with STARTTLS, or nodemailer refuses to
 * send. Only host, port and credentials are taken from the URL, so its query cannot switch that
 * off.
 *
 * @param smtpUrl The `smtp://` URL of the server.
 * @returns The transport options.
 */
function smtpTransportOptions(smtpUrl: string): SmtpTransportOptions {
	const url = new URL(smtpUrl);
	const options: SmtpTransportOptions = {
		// The URL keeps an IPv6 address in brackets, the socket wants it without.
		host: url.hostname.replace(/^\[(?<address>.*)\]$/u, '$<address>'),
		requireTLS: !LOOPBACK_HOSTS.has(url.hostname),
	};
	if (url.port !== '') options.port = Number(url.port);
	if (url.username !== '') {
		options.auth = {
			pass: decodeURIComponent(url.password),
			user: decodeURIComponent(url.username),
		};
	}
	return options;
}

/**
 * Opens an SMTP transport. Kept in its own module so only the Node path ever loads `nodemailer`,
 * see `createSystemMailer`.
 *
 * @param smtpUrl The `smtp://` URL of the server.
 * @returns The transport.
 */
function openSmtpTransport(smtpUrl: string): SmtpTransport {
	return createTransport(smtpTransportOptions(smtpUrl));
}

export { openSmtpTransport, smtpTransportOptions };
export type { SmtpTransport };
