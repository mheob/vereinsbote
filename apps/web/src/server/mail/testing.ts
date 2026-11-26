import type { SystemMail, SystemMailDelivery, SystemMailer } from './system-mailer';

/** Test mailer: keeps every mail in `sent` instead of sending it, once it is delivered. */
class CapturingMailer implements SystemMailer {
	public readonly sent: SystemMail[] = [];

	// oxlint-disable-next-line typescript/require-await -- the interface is async, recording is not
	public async prepare(mail: Readonly<SystemMail> | null): Promise<SystemMailDelivery | null> {
		if (mail === null) return null;
		// oxlint-disable-next-line typescript/require-await -- see above
		return async () => {
			this.sent.push({ ...mail });
		};
	}

	// oxlint-disable-next-line typescript/require-await -- the interface is async, recording is not
	public async send(mail: Readonly<SystemMail>): Promise<void> {
		this.sent.push({ ...mail });
	}
}

export { CapturingMailer };
