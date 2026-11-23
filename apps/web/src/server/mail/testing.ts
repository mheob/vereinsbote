import type { SystemMail, SystemMailer } from './system-mailer';

/** Test mailer: keeps every mail in `sent` instead of sending it. */
class CapturingMailer implements SystemMailer {
	public readonly sent: SystemMail[] = [];

	// oxlint-disable-next-line typescript/require-await -- the interface is async, recording is not
	public async send(mail: Readonly<SystemMail>): Promise<void> {
		this.sent.push({ ...mail });
	}
}

export { CapturingMailer };
