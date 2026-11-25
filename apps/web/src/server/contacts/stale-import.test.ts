import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import type { Db } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';
import { createSystemMailer } from '@/server/mail/system-mailer';
import { CapturingMailer } from '@/server/mail/testing';
import { runTick } from '@/server/tick/tick';
import { insertUser } from '@/server/users/repo';

import { recordConfirmedImport } from './import-state';
import { setStaleImportWeeks } from './settings';
import { getImportFreshness, createStaleImportWarningStep } from './stale-import';
import { setUpClub } from './testing';

const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 5).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://x@localhost/x',
});

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-24T10:00:00Z');

function daysAfter(at: Date, days: number): Date {
	return new Date(at.getTime() + days * DAY_MS);
}

async function lastImportedWeeksAgo(db: Db, weeks: number): Promise<void> {
	await recordConfirmedImport(db, 'member', { at: daysAfter(NOW, -7 * weeks), mapping: null });
}

async function warningEntries(db: Db): Promise<(typeof auditLog.$inferSelect)[]> {
	return db.select().from(auditLog).where(eq(auditLog.action, 'import.stale_warning'));
}

async function tickAt(
	db: Db,
	at: Date,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the mailer records into `sent`
	mailer: CapturingMailer,
): Promise<void> {
	await runTick({
		db,
		env,
		now: () => at,
		steps: [createStaleImportWarningStep(() => mailer)],
		storage: null,
	});
}

describe(getImportFreshness, () => {
	it('is not stale without an import, and stale only after the weeks', async () => {
		const db = await createTestDb();
		await expect(getImportFreshness(db, NOW)).resolves.toStrictEqual({
			lastImportAt: null,
			stale: false,
			weeks: 8,
		});
		await lastImportedWeeksAgo(db, 8);
		await expect(getImportFreshness(db, NOW)).resolves.toMatchObject({ stale: false });
		await expect(getImportFreshness(db, daysAfter(NOW, 1))).resolves.toMatchObject({
			stale: true,
		});
	});
});

describe(createStaleImportWarningStep, () => {
	it('warns nobody before the first import', async () => {
		const db = await createTestDb();
		await setUpClub(db);
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		expect(mailer.sent).toStrictEqual([]);
	});

	it('sends one warning per week to active admins in their language', async () => {
		const db = await createTestDb();
		await setUpClub(db);
		await insertUser(db, {
			email: 'en-admin@example.org',
			isAdmin: true,
			locale: 'en',
			name: 'English Admin',
			status: 'active',
		});
		await insertUser(db, {
			email: 'invited-admin@example.org',
			isAdmin: true,
			name: 'Invited',
			status: 'invited',
		});
		await insertUser(db, { email: 'plain@example.org', name: 'Plain', status: 'active' });
		await lastImportedWeeksAgo(db, 9);
		const mailer = new CapturingMailer();

		await tickAt(db, NOW, mailer);
		expect(mailer.sent.map((mail) => mail.subject).toSorted()).toStrictEqual([
			'Die Mitgliederdaten im Vereinsbote sind veraltet',
			'The member data in Vereinsbote is out of date',
		]);
		for (const mail of mailer.sent) {
			expect(mail.text).toContain('https://bote.example.org/contacts/import/members');
		}
		const german = mailer.sent.find((mail) => mail.to === 'admin@example.org');
		expect(german?.text).toContain('Hallo Test Admin');
		expect(german?.text).toContain('der letzte Mitglieder-Import war am 22. September 2026');
	});

	it('warns again only after seven days', async () => {
		const db = await createTestDb();
		await setUpClub(db);
		await lastImportedWeeksAgo(db, 9);
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		await tickAt(db, daysAfter(NOW, 6), mailer);
		expect(mailer.sent).toHaveLength(1);
		await tickAt(db, daysAfter(NOW, 7), mailer);
		expect(mailer.sent).toHaveLength(2);
	});

	it('does not retry within the week without a mailer', async () => {
		const db = await createTestDb();
		await setUpClub(db);
		await insertUser(db, {
			email: 'second@example.org',
			isAdmin: true,
			name: 'Second',
			status: 'active',
		});
		await lastImportedWeeksAgo(db, 9);
		const step = createStaleImportWarningStep(createSystemMailer);
		const report = await runTick({ db, env, now: () => NOW, steps: [step], storage: null });
		expect(report).toMatchObject({ steps: [{ name: 'stale-import-warning', outcome: 'done' }] });
		const [entry] = await warningEntries(db);
		expect(entry).toMatchObject({
			action: 'import.stale_warning',
			details: { error: 'MailerNotConfiguredError', failed: 2, sent: 0 },
		});
		await runTick({ db, env, now: () => daysAfter(NOW, 0.1), steps: [step], storage: null });
		await expect(warningEntries(db)).resolves.toHaveLength(1);
	});

	it('stops warning after a new import', async () => {
		const db = await createTestDb();
		await setUpClub(db);
		await lastImportedWeeksAgo(db, 9);
		await recordConfirmedImport(db, 'member', { at: NOW, mapping: null });
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		expect(mailer.sent).toStrictEqual([]);
	});

	it('uses the configured weeks', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await setStaleImportWeeks(db, admin, 12);
		await lastImportedWeeksAgo(db, 9);
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		expect(mailer.sent).toStrictEqual([]);
	});
});
