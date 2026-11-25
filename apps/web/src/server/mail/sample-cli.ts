/*
 * `vp run --filter web mail:sample`: sends the sample mails to Mailpit (`DEV_SMTP_URL`) for a look
 * at the mail design, in the Mailpit inbox or, through its relay, in real mail clients (README).
 */
import { buildSampleMails } from './sample-mails';
import { openSmtpTransport } from './smtp-transport';

const SAMPLE_RECIPIENT = 'sample@example.org';
const DEFAULT_APP_URL = 'http://localhost:3000';

/**
 * Reads a setting from the environment. The app's own parsing (`parseEnv`) demands the whole
 * environment, which this script has no use for.
 *
 * @param name The variable.
 * @returns The trimmed value, or an empty text when unset.
 */
function setting(name: string): string {
	// oxlint-disable-next-line node/no-process-env -- standalone script, runs outside the app's env parsing
	return process.env[name]?.trim() ?? '';
}

const smtpUrl = setting('DEV_SMTP_URL');
if (!smtpUrl.startsWith('smtp://')) {
	throw new Error('DEV_SMTP_URL is not set. It must be an smtp:// URL, e.g. of Mailpit.');
}
const appUrl = setting('APP_URL') === '' ? DEFAULT_APP_URL : setting('APP_URL');

const transport = openSmtpTransport(smtpUrl);
const from = `Vereinsbote <noreply@${new URL(appUrl).hostname}>`;
// oxlint-disable-next-line node/no-top-level-await -- tsx runs this file as an ES module script
const mails = await buildSampleMails(appUrl);
for (const { attachments, mail, name } of mails) {
	// oxlint-disable-next-line node/no-top-level-await, no-await-in-loop -- one mail after the other, in order
	await transport.sendMail({
		attachments,
		from,
		html: mail.html,
		subject: mail.subject,
		text: mail.text,
		to: SAMPLE_RECIPIENT,
	});
	// oxlint-disable-next-line no-console -- CLI output
	console.log(`Sent ${name}.`);
}
