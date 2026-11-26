import { describe, expect, it } from 'vite-plus/test';

import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';

import { createSystemMailer, MailerNotConfiguredError } from './system-mailer';
import type { SystemMail } from './system-mailer';
import { CapturingMailer } from './testing';

const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 3).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://x@localhost/x',
});

const mail: SystemMail = {
	content: { button: null, heading: 'Überschrift', paragraphs: ['Text'] },
	locale: 'de',
	subject: 'Betreff',
	to: 'anna@verein.de',
};

describe(createSystemMailer, () => {
	it('refuses to send when no transport is configured', async () => {
		const db = await createTestDb();
		await expect(createSystemMailer({ db, env }).send(mail)).rejects.toBeInstanceOf(
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

	it('records a prepared mail once it is delivered', async () => {
		const mailer = new CapturingMailer();
		await expect(mailer.prepare(null)).resolves.toBeNull();
		const delivery = await mailer.prepare(mail);
		expect(mailer.sent).toStrictEqual([]);
		await delivery?.();
		expect(mailer.sent).toStrictEqual([mail]);
	});
});
