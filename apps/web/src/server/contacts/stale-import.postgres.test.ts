import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { setUpClub } from '@/server/contacts/testing';
import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { auditLog } from '@/server/db/schema';
import { parseEnv } from '@/server/env';
import { CapturingMailer } from '@/server/mail/testing';
import { runTick } from '@/server/tick/tick';
import { insertUser } from '@/server/users/repo';

import { recordConfirmedImport } from './import-state';
import { createStaleImportWarningStep } from './stale-import';

/*
 * The stale-data warning on PostgreSQL, where a failed mail of two does not stop the other and
 * the week stays claimed. It needs `TEST_POSTGRES_URL`, a connection whose user may create
 * databases (CI and `docker/compose.dev.yml` provide one), and is skipped without it. It works in
 * a database of its own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const SETUP_TIMEOUT_MS = 60_000;
const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-24T10:00:00Z');
const env = parseEnv({
	APP_SECRET: Buffer.alloc(32, 5).toString('base64'),
	APP_URL: 'https://bote.example.org',
	CRON_SECRET: 'c'.repeat(32),
	DATABASE_URL: 'postgres://x@localhost/x',
});

/**
 * A mailer that refuses the mail to one address and records the others.
 *
 * @param refused The address that fails.
 * @param delivered Where the other mails go.
 * @returns The mailer.
 */
function refusing(
	refused: string,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the mailer records into `sent`
	delivered: CapturingMailer,
): CapturingMailer {
	const mailer = new CapturingMailer();
	mailer.send = async (mail) => {
		await (mail.to === refused
			? Promise.reject(new Error('The provider refused the mail.'))
			: delivered.send(mail));
	};
	return mailer;
}

describe.skipIf(serverUrl === '')(
	'the stale-data warning on PostgreSQL (skipped without TEST_POSTGRES_URL)',
	() => {
		const name = `vereinsbote_test_${crypto.randomUUID().replaceAll('-', '')}`;
		let server: DbHandle | undefined;
		let handle: DbHandle | undefined;

		beforeAll(async () => {
			server = openPgDb(serverUrl);
			await server.db.execute(sql.raw(`create database "${name}"`));
			const url = new URL(serverUrl);
			url.pathname = `/${name}`;
			handle = openPgDb(url.href);
			await runMigrations(handle.db);
			await setUpClub(handle.db);
			await insertUser(handle.db, {
				email: 'second-admin@example.org',
				isAdmin: true,
				name: 'Second Admin',
				status: 'active',
			});
			await recordConfirmedImport(handle.db, 'member', {
				at: new Date(NOW.getTime() - 63 * DAY_MS),
				mapping: null,
			});
		}, SETUP_TIMEOUT_MS);

		afterAll(async () => {
			await handle?.end();
			await server?.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
			await server?.end();
		});

		/**
		 * The database of this test.
		 *
		 * @returns The database.
		 */
		function testDb(): Db {
			if (handle === undefined) throw new Error('The database was not set up.');
			return handle.db;
		}

		it('sends the stale warning once when one of two mails fails', async () => {
			const db = testDb();
			const delivered = new CapturingMailer();
			const steps = [
				createStaleImportWarningStep(() => refusing('second-admin@example.org', delivered)),
			];
			await runTick({ db, env, now: () => NOW, steps, storage: null });
			// The week is claimed: neither the delivered nor the failed mail is repeated.
			await runTick({ db, env, now: () => new Date(NOW.getTime() + DAY_MS), steps, storage: null });
			const entries = await db
				.select({ details: auditLog.details })
				.from(auditLog)
				.where(eq(auditLog.action, 'import.stale_warning'));
			expect(delivered.sent.map((mail) => mail.to)).toStrictEqual(['admin@example.org']);
			expect(entries).toMatchObject([{ details: { failed: 1, sent: 1 } }]);
		});
	},
);
