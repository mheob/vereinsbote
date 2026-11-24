import { setImmediate as nextTurn } from 'node:timers/promises';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { waitForLockWaiters } from '@/server/db/postgres-testing';
import { contacts, contactSuppressions } from '@/server/db/schema';
import type { Principal } from '@/server/permissions/principal';

import { getImportState, lockImportState } from './import-state';
import type { PartnerInput } from './partner-form';
import { createPartner, deletePartner, updatePartner } from './partners';
import { setOptOut, setSuppression } from './suppressions';
import { setUpClub, userWith } from './testing';

/*
 * Partner upkeep, suppressions and opt-outs on PostgreSQL. PGlite runs one statement at a time,
 * so it shows neither a wait for a lock nor queries queued on the connection of a transaction
 * (node-postgres warns about those: deprecated in pg@9). It needs `TEST_POSTGRES_URL`, a
 * connection whose user may create databases (CI and `docker/compose.dev.yml` provide one), and
 * is skipped without it. It works in a database of its own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const SETUP_TIMEOUT_MS = 60_000;

const stadtwerke: PartnerInput = {
	customerNumber: '',
	email: 'presse@stadtwerke.example',
	firstName: '',
	gender: 'unspecified',
	lastName: '',
	organization: 'Stadtwerke',
	tags: ['Sponsor'],
};

describe.skipIf(serverUrl === '')(
	'partner upkeep on PostgreSQL (skipped without TEST_POSTGRES_URL)',
	() => {
		const name = `vereinsbote_test_${crypto.randomUUID().replaceAll('-', '')}`;
		const pgWarnings: string[] = [];
		/**
		 * Collects the warnings of node-postgres.
		 *
		 * @param warning A process warning.
		 */
		const onWarning = (warning: Readonly<Error>): void => {
			if (warning.message.includes('pg@9')) pgWarnings.push(warning.message);
		};
		let server: DbHandle | undefined;
		let handle: DbHandle | undefined;
		let editor: Principal | undefined;
		let partnersAreaId: string | undefined;

		beforeAll(async () => {
			process.on('warning', onWarning);
			server = openPgDb(serverUrl);
			await server.db.execute(sql.raw(`create database "${name}"`));
			const url = new URL(serverUrl);
			url.pathname = `/${name}`;
			handle = openPgDb(url.href);
			await runMigrations(handle.db);
			const club = await setUpClub(handle.db);
			({ partnersAreaId } = club);
			editor = await userWith(handle.db, { [partnersAreaId]: 'edit' });
		}, SETUP_TIMEOUT_MS);

		afterAll(async () => {
			process.off('warning', onWarning);
			await handle?.end();
			await server?.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
			await server?.end();
		});

		/**
		 * The database and the partner editor of this test.
		 *
		 * @returns The Drizzle client, a user with `edit` in "Finanzen" and the id of "Finanzen".
		 */
		function testClub(): { db: Db; editor: Principal; partnersAreaId: string } {
			if (handle === undefined || editor === undefined || partnersAreaId === undefined) {
				throw new Error('The test database is not open.');
			}
			return { db: handle.db, editor, partnersAreaId };
		}

		it('runs one query at a time on the connection of a transaction', async () => {
			const { db, editor: principal, partnersAreaId: areaId } = testClub();
			const { contactId } = await createPartner(db, principal, stadtwerke);
			await updatePartner(db, principal, contactId, { ...stadtwerke, customerNumber: '100009' });
			await setSuppression(db, principal, contactId, true);
			await setOptOut(db, principal, { areaId, contactId, optedOut: true });
			await deletePartner(db, principal, contactId);
			// `util.deprecate` emits its warning on a later turn of the event loop.
			await nextTurn();
			expect(pgWarnings).toStrictEqual([]);
		});

		it('waits for a running partner import before changing partners', async () => {
			const { db, editor: principal } = testClub();
			const { contactId } = await createPartner(db, principal, {
				...stadtwerke,
				email: 'info@druckerei.example',
				organization: 'Druckerei',
			});
			const { stockVersion: version } = await getImportState(db, 'partner');
			// A partner import holds the import state of the partners until it ends.
			const locked = Promise.withResolvers<boolean>();
			const release = Promise.withResolvers<boolean>();
			const partnerImport = db.transaction(async (tx) => {
				await lockImportState(tx, 'partner');
				locked.resolve(true);
				await release.promise;
			});
			await locked.promise;
			const changes = Promise.all([
				createPartner(db, principal, { ...stadtwerke, organization: 'Stadtwerke Süd' }),
				setSuppression(db, principal, contactId, true),
			]);
			await waitForLockWaiters(db, 2);
			const whileImporting = await db
				.select({ id: contacts.id })
				.from(contacts)
				.where(eq(contacts.organization, 'Stadtwerke Süd'));
			expect(whileImporting).toStrictEqual([]);
			release.resolve(true);
			await partnerImport;
			await changes;
			await expect(
				db
					.select({ key: contactSuppressions.contactKey })
					.from(contactSuppressions)
					.where(eq(contactSuppressions.contactKey, 'email:info@druckerei.example')),
			).resolves.toHaveLength(1);
			await expect(getImportState(db, 'partner')).resolves.toMatchObject({
				stockVersion: version + 2,
			});
		});

		it('suppresses a partner under the key a running change gives it', async () => {
			const { db, editor: principal } = testClub();
			const { contactId } = await createPartner(db, principal, {
				...stadtwerke,
				email: 'alt@verlag.example',
				organization: 'Verlag',
			});
			// A change of the partner's address holds the import state until it ends.
			const changed = Promise.withResolvers<boolean>();
			const release = Promise.withResolvers<boolean>();
			const change = db.transaction(async (tx) => {
				await lockImportState(tx, 'partner');
				await tx
					.update(contacts)
					.set({ email: 'neu@verlag.example' })
					.where(eq(contacts.id, contactId));
				changed.resolve(true);
				await release.promise;
			});
			await changed.promise;
			const suppression = setSuppression(db, principal, contactId, true);
			await waitForLockWaiters(db, 1);
			release.resolve(true);
			await change;
			await suppression;
			const keys = await db
				.select({ key: contactSuppressions.contactKey })
				.from(contactSuppressions)
				.where(sql`${contactSuppressions.contactKey} like '%@verlag.example'`);
			expect(keys).toStrictEqual([{ key: 'email:neu@verlag.example' }]);
		});
	},
);
