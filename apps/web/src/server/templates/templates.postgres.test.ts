import { setImmediate as nextTurn } from 'node:timers/promises';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { createArea } from '@/server/areas/areas';
import { setUpClub, userWith } from '@/server/contacts/testing';
import type { Db, DbHandle } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { openPgDb } from '@/server/db/pg-client';
import { waitForLockWaiters } from '@/server/db/postgres-testing';
import { templates } from '@/server/db/schema';
import { storeImage } from '@/server/media/media';
import { pngBytes } from '@/server/media/testing';
import type { Principal } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';

import { TemplateChangedError } from './errors';
import {
	createTemplate,
	deleteTemplate,
	duplicateTemplate,
	getTemplate,
	saveTemplate,
} from './templates';

/*
 * Templates on PostgreSQL. PGlite runs one statement at a time, so it shows neither a wait for
 * the row lock of two saves nor queries queued on the connection of a transaction (node-postgres
 * warns about those: deprecated in pg@9). It needs `TEST_POSTGRES_URL`, a connection whose user
 * may create databases (CI and `docker/compose.dev.yml` provide one), and is skipped without it.
 * It works in a database of its own, which it drops at the end.
 */

// oxlint-disable-next-line node/no-process-env -- the test runs only where a PostgreSQL server is offered
const serverUrl = process.env.TEST_POSTGRES_URL ?? '';
const SETUP_TIMEOUT_MS = 60_000;

/**
 * A template input.
 *
 * @param name The name.
 * @param subject The subject.
 * @param blocks The blocks.
 * @returns The input.
 */
function input(
	name: string,
	subject: string,
	blocks: Extract<TemplateInput['body'], { kind: 'blocks' }>['blocks'] = [],
): TemplateInput {
	return {
		body: { blocks, kind: 'blocks', layout: { kind: 'standard' } },
		name,
		preheader: '',
		salutationForm: 'du',
		salutationTexts: DEFAULT_SALUTATIONS.du,
		subject,
	};
}

/**
 * What a settled save gave.
 *
 * @param result The settled save.
 * @returns Its result, or the error it failed with.
 */
function outcomeOf(result: Readonly<PromiseSettledResult<Readonly<{ version: number }>>>): unknown {
	return result.status === 'fulfilled' ? result.value : result.reason;
}

describe.skipIf(serverUrl === '')(
	'templates on PostgreSQL (skipped without TEST_POSTGRES_URL)',
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
		let membersAreaId: string | undefined;
		let eventsAreaId: string | undefined;

		beforeAll(async () => {
			process.on('warning', onWarning);
			server = openPgDb(serverUrl);
			await server.db.execute(sql.raw(`create database "${name}"`));
			const url = new URL(serverUrl);
			url.pathname = `/${name}`;
			handle = openPgDb(url.href);
			await runMigrations(handle.db);
			const club = await setUpClub(handle.db);
			({ membersAreaId } = club);
			({ areaId: eventsAreaId } = await createArea(handle.db, club.admin, 'Veranstaltungen'));
			editor = await userWith(handle.db, { [eventsAreaId]: 'edit', [membersAreaId]: 'edit' });
		}, SETUP_TIMEOUT_MS);

		afterAll(async () => {
			process.off('warning', onWarning);
			await handle?.end();
			await server?.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
			await server?.end();
		});

		/**
		 * The database and the template editor of this test.
		 *
		 * @returns The Drizzle client, a user with `edit` in both areas and the two area ids.
		 */
		function testClub(): {
			db: Db;
			editor: Principal;
			membersAreaId: string;
			eventsAreaId: string;
		} {
			if (
				handle === undefined ||
				editor === undefined ||
				membersAreaId === undefined ||
				eventsAreaId === undefined
			) {
				throw new Error('The test database is not open.');
			}
			return { db: handle.db, editor, eventsAreaId, membersAreaId };
		}

		it('runs one query at a time on the connection of a transaction', async () => {
			const club = testClub();
			const { db } = club;
			const storage = createMemoryStorage();
			const image = await storeImage(
				db,
				storage,
				club.editor,
				{ areaId: club.membersAreaId, purpose: 'library' },
				{ bytes: pngBytes(600, 300, 100), name: 'vereinsheim.png' },
			);
			const blocks = [
				{
					alt: 'Vereinsheim',
					decorative: false,
					href: null,
					id: 'i',
					mediaId: image.id,
					type: 'image',
				} as const,
			];
			const created = input('Sommerfest', 'Einladung', blocks);
			const { id } = await createTemplate(db, club.editor, club.membersAreaId, created);
			await saveTemplate(db, club.editor, id, input('Sommerfest', 'Neu', blocks), 1);
			const copy = await duplicateTemplate(
				db,
				storage,
				club.editor,
				id,
				club.eventsAreaId,
				'Kopie',
			);
			await deleteTemplate(db, club.editor, copy.id, 1);
			// `util.deprecate` emits its warning on a later turn of the event loop.
			await nextTurn();
			expect(pgWarnings).toStrictEqual([]);
		});

		it('lets one of two saves of the same version through and refuses the other', async () => {
			const club = testClub();
			const { db } = club;
			const { id } = await createTemplate(
				db,
				club.editor,
				club.membersAreaId,
				input('Herbstfest', 'Einladung'),
			);
			// Another save holds the row; both tabs then wait for it and save one after the other.
			const locked = Promise.withResolvers<boolean>();
			const release = Promise.withResolvers<boolean>();
			const holder = db.transaction(async (tx) => {
				await tx.select().from(templates).where(eq(templates.id, id)).for('update');
				locked.resolve(true);
				await release.promise;
			});
			await locked.promise;
			const tabs = Promise.allSettled([
				saveTemplate(db, club.editor, id, input('Herbstfest', 'Erster Tab'), 1),
				saveTemplate(db, club.editor, id, input('Herbstfest', 'Zweiter Tab'), 1),
			]);
			await waitForLockWaiters(db, 2);
			release.resolve(true);
			await holder;
			const settled = await tabs;
			const outcomes = settled.map((result) => outcomeOf(result));
			expect(outcomes.filter((outcome) => outcome instanceof TemplateChangedError)).toHaveLength(1);
			expect(outcomes).toContainEqual({ version: 2 });
			const saved = await getTemplate(db, club.editor, id);
			expect(saved.version).toBe(2);
			expect(['Erster Tab', 'Zweiter Tab']).toContain(saved.subject);
		});
	},
);
