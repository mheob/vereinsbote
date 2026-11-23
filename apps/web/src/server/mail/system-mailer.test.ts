import { describe, expect, it } from 'vite-plus/test';

import { parseEnv } from '../env';
import { createSystemMailer, MailerNotConfiguredError } from './system-mailer';
import { CapturingMailer } from './testing';

const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 3).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://x@localhost/x',
});

const mail = { subject: 'Betreff', text: 'Text', to: 'anna@verein.de' };

describe(createSystemMailer, () => {
	it('refuses to send when no transport is configured', async () => {
		await expect(createSystemMailer(env).send(mail)).rejects.toBeInstanceOf(
			MailerNotConfiguredError,
		);
	});
});

describe(CapturingMailer, () => {
	it('records every mail', async () => {
		const mailer = new CapturingMailer();
		await mailer.send(mail);
		expect(mailer.sent).toStrictEqual([mail]);
	});
});
