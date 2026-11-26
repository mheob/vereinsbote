/*
 * The system mails of the app (login links, invitations, warnings) go through the system sender,
 * see `server/sending/system-mailer.ts`. Callers outside the sending modules import them here.
 */
export {
	MailerNotConfiguredError,
	SystemMailNotSentError,
	createSystemMailer,
	hasSystemSender,
} from '@/server/sending/system-mailer';
export type {
	SystemMail,
	SystemMailDelivery,
	SystemMailer,
	SystemMailerDeps,
} from '@/server/sending/system-mailer';
export type { SystemMailContent } from '@/server/sending/system-mail';
