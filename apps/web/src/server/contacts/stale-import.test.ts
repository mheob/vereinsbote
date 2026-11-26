import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import type { Db } from '@/server/db/client';
import { auditLog, systemState } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';
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
			expect(mail.content.button?.url).toBe('https://bote.example.org/contacts/import/members');
		}
		const german = mailer.sent.find((mail) => mail.to === 'admin@example.org');
		expect(german).toMatchObject({
			content: {
				button: { label: 'Mitglieder importieren' },
				heading: 'Die Mitgliederdaten sind veraltet',
				paragraphs: [
					'Hallo Test Admin,',
					'der letzte Mitglieder-Import war am 22. September 2026. Bitte lade einen aktuellen Export hoch.',
				],
			},
			locale: 'de',
		});
		const english = mailer.sent.find((mail) => mail.to === 'en-admin@example.org');
		expect(english).toMatchObject({
			content: { heading: 'The member data is out of date' },
			locale: 'en',
		});
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
		// The real mailer: no system sender and no SMTP in the tests.
		const step = createStaleImportWarningStep();
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

	it('takes the claimed week back when the audit entry fails', async () => {
		const db = await createTestDb();
		await setUpClub(db);
		await lastImportedWeeksAgo(db, 9);
		const breaking = new CapturingMailer();
		const originalSend = breaking.send.bind(breaking);
		breaking.send = async (mail) => {
			await originalSend(mail);
			// The log is gone by the time the warning is written.
			await db.execute(sql`alter table audit_log rename to audit_log_gone`);
		};
		const report = await runTick({
			db,
			env,
			now: () => NOW,
			steps: [createStaleImportWarningStep(() => breaking)],
			storage: null,
		});
		expect(report).toMatchObject({ steps: [{ name: 'stale-import-warning', outcome: 'error' }] });
		await expect(
			db.select().from(systemState).where(eq(systemState.key, 'stale_import_warned_at')),
		).resolves.toStrictEqual([]);

		await db.execute(sql`alter table audit_log_gone rename to audit_log`);
		const mailer = new CapturingMailer();
		await tickAt(db, daysAfter(NOW, 0.1), mailer);
		expect(mailer.sent).toHaveLength(1);
	});

	it('restores the earlier week when the audit entry fails', async () => {
		const db = await createTestDb();
		await setUpClub(db);
		await lastImportedWeeksAgo(db, 12);
		await tickAt(db, daysAfter(NOW, -8), new CapturingMailer());
		const [before] = await db
			.select()
			.from(systemState)
			.where(eq(systemState.key, 'stale_import_warned_at'));
		const breaking = new CapturingMailer();
		breaking.send = async () => {
			await db.execute(sql`alter table audit_log rename to audit_log_gone`);
		};
		await runTick({
			db,
			env,
			now: () => NOW,
			steps: [createStaleImportWarningStep(() => breaking)],
			storage: null,
		});
		const [after] = await db
			.select()
			.from(systemState)
			.where(eq(systemState.key, 'stale_import_warned_at'));
		expect(after?.value).toStrictEqual(before?.value);
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
