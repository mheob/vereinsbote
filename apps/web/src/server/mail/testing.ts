import type { SystemMail, SystemMailDelivery, SystemMailer } from './system-mailer';

/** Test mailer: keeps every mail in `sent` instead of sending it, once it is delivered. */
class CapturingMailer implements SystemMailer {
	public readonly sent: SystemMail[] = [];

	// The interface is async, recording is not: each method records at once, then yields once.
	public async prepare(mail: Readonly<SystemMail> | null): Promise<SystemMailDelivery | null> {
		await Promise.resolve();
		if (mail === null) return null;
		return async () => {
			await this.send(mail);
		};
	}

	public async send(mail: Readonly<SystemMail>): Promise<void> {
		this.sent.push({ ...mail });
		await Promise.resolve();
	}
}

export { CapturingMailer };
