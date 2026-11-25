import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { setUpClub, userWith } from '@/server/contacts/testing';
import { auditLog, layouts } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';
import {
	LayoutChangedError,
	LayoutInUseError,
	LayoutNameInvalidError,
	LayoutNameTakenError,
	LayoutNotFoundError,
} from '@/server/templates/errors';
import { APP_ORIGIN, createTemplate } from '@/server/templates/testing';

import { createLayout, deleteLayout, getLayout, listLayouts, replaceLayout } from './layouts';

const FRAME = '<div><h1>{{brand.name}}</h1>{{content}}</div>';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

type Db = Awaited<ReturnType<typeof createTestDb>>;

interface Club {
	readonly db: Db;
	readonly admin: Awaited<ReturnType<typeof setUpClub>>['admin'];
	readonly editor: Awaited<ReturnType<typeof userWith>>;
	readonly areaId: string;
}

/**
 * A club with its admin and an editor of the first area.
 *
 * @returns The database, the admin, the editor and the area.
 */
async function club(): Promise<Club> {
	const db = await createTestDb();
	const { admin, membersAreaId } = await setUpClub(db);
	const editor = await userWith(db, { [membersAreaId]: 'edit' });
	return { admin, areaId: membersAreaId, db, editor };
}

/**
 * Creates a layout as the admin.
 *
 * @param setUp The club.
 * @param setUp.db The database.
 * @param setUp.admin The admin.
 * @param name The name of the layout.
 * @param source The HTML.
 * @returns The id.
 */
async function layoutNamed(
	setUp: Readonly<Pick<Club, 'admin' | 'db'>>,
	name: string,
	source = FRAME,
): Promise<string> {
	const created = await createLayout(setUp.db, setUp.admin, { name, source }, APP_ORIGIN);
	if (!('id' in created)) throw new Error('The layout was refused.');
	return created.id;
}

/**
 * Lets a template use a layout.
 *
 * @param setUp The club.
 * @param layoutId The layout.
 * @param name The name of the template.
 */
async function useLayout(setUp: Readonly<Club>, layoutId: string, name: string): Promise<void> {
	await createTemplate(setUp.db, setUp.editor, setUp.areaId, {
		body: {
			blocks: [{ content: [{ text: 'Hallo', type: 'text' }], id: 'h', level: 1, type: 'heading' }],
			kind: 'blocks',
			layout: { kind: 'shared', layoutId },
		},
		name,
		preheader: '',
		salutationForm: 'du',
		salutationTexts: DEFAULT_SALUTATIONS.du,
		subject: 'Betreff',
	});
}

describe('global layouts', () => {
	it('lets only admins list, create, replace and delete', async () => {
		const setUp = await club();
		const id = await layoutNamed(setUp, 'Rahmen');
		const { db, editor } = setUp;
		await expect(listLayouts(db, editor)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(getLayout(db, editor, id)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			createLayout(db, editor, { name: 'Neu', source: FRAME }, APP_ORIGIN),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(replaceLayout(db, editor, id, FRAME, 1, APP_ORIGIN)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(deleteLayout(db, editor, id)).rejects.toBeInstanceOf(ForbiddenError);
	});

	it('creates a layout with cleaned HTML, lists it and logs its id', async () => {
		const setUp = await club();
		const { admin, db } = setUp;
		const source = '<div><script>alert(1)</script>{{content}}</div>';
		const id = await layoutNamed(setUp, '  Rahmen  ', source);
		const [row] = await db.select().from(layouts).where(eq(layouts.id, id));
		expect(row).toMatchObject({ name: 'Rahmen', version: 1 });
		expect(row?.html).not.toContain('script');
		expect(row?.html).toContain('{{content}}');
		const listed = await listLayouts(db, admin);
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({ id, name: 'Rahmen', usedBy: 0 });
	});

	it('logs the creation with the id of the layout and not its name', async () => {
		const setUp = await club();
		const id = await layoutNamed(setUp, 'Rahmen');
		const entries = await setUp.db
			.select()
			.from(auditLog)
			.where(eq(auditLog.action, 'layout.created'));
		expect(entries.map(({ target }) => target)).toStrictEqual([`layout:${id}`]);
		expect(JSON.stringify(entries)).not.toContain('Rahmen');
	});

	it('refuses contact placeholders other than base fields and stores nothing', async () => {
		const { admin, db } = await club();
		const refused = await createLayout(
			db,
			admin,
			{ name: 'Rahmen', source: '<div><p>{{contact.birthDate}}</p>{{content}}</div>' },
			APP_ORIGIN,
		);
		expect(refused).toStrictEqual({
			refusals: [{ key: 'contact.birthDate', kind: 'placeholderForbidden' }],
		});
		await expect(listLayouts(db, admin)).resolves.toStrictEqual([]);
		const allowed = await createLayout(
			db,
			admin,
			{
				name: 'Rahmen',
				source: '<div><p>{{contact.firstName}} {{brand.name}}</p>{{content}}</div>',
			},
			APP_ORIGIN,
		);
		expect(allowed).toHaveProperty('id');
	});

	it('refuses a layout without {{content}}', async () => {
		const { admin, db } = await club();
		const refused = await createLayout(
			db,
			admin,
			{ name: 'Rahmen', source: '<div>Kein Inhalt</div>' },
			APP_ORIGIN,
		);
		expect(refused).toStrictEqual({ refusals: [{ kind: 'contentMissing' }] });
		await expect(listLayouts(db, admin)).resolves.toStrictEqual([]);
	});

	it('refuses an empty, a too long and a taken name', async () => {
		const setUp = await club();
		const { admin, db } = setUp;
		await layoutNamed(setUp, 'Rahmen');
		await expect(
			createLayout(db, admin, { name: '   ', source: FRAME }, APP_ORIGIN),
		).rejects.toBeInstanceOf(LayoutNameInvalidError);
		await expect(
			createLayout(db, admin, { name: 'x'.repeat(101), source: FRAME }, APP_ORIGIN),
		).rejects.toBeInstanceOf(LayoutNameInvalidError);
		await expect(
			createLayout(db, admin, { name: 'RAHMEN', source: FRAME }, APP_ORIGIN),
		).rejects.toBeInstanceOf(LayoutNameTakenError);
	});

	it('loads a layout with its version and the number of templates that use it', async () => {
		const setUp = await club();
		const id = await layoutNamed(setUp, 'Rahmen');
		await useLayout(setUp, id, 'Eins');
		await useLayout(setUp, id, 'Zwei');
		const layout = await getLayout(setUp.db, setUp.admin, id);
		expect(layout).toMatchObject({ id, name: 'Rahmen', usedBy: 2, version: 1 });
		expect(layout.html).toContain('{{content}}');
		await expect(getLayout(setUp.db, setUp.admin, UNKNOWN_ID)).rejects.toBeInstanceOf(
			LayoutNotFoundError,
		);
	});

	it('replaces the HTML with the current version and refuses an old one', async () => {
		const setUp = await club();
		const { admin, db } = setUp;
		const id = await layoutNamed(setUp, 'Rahmen');
		const next = '<section>{{content}}<p>Fuß</p></section>';
		await expect(replaceLayout(db, admin, id, next, 1, APP_ORIGIN)).resolves.toStrictEqual({
			version: 2,
		});
		const [row] = await db.select().from(layouts).where(eq(layouts.id, id));
		expect(row?.html).toContain('Fuß');
		await expect(replaceLayout(db, admin, id, FRAME, 1, APP_ORIGIN)).rejects.toBeInstanceOf(
			LayoutChangedError,
		);
		const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'layout.updated'));
		expect(entries.map(({ target }) => target)).toStrictEqual([`layout:${id}`]);
	});

	it('refuses a replacement that does not pass the import and keeps the old HTML', async () => {
		const setUp = await club();
		const { admin, db } = setUp;
		const id = await layoutNamed(setUp, 'Rahmen');
		const refused = await replaceLayout(db, admin, id, '<p>ohne Inhalt</p>', 1, APP_ORIGIN);
		expect(refused).toStrictEqual({ refusals: [{ kind: 'contentMissing' }] });
		const [row] = await db.select().from(layouts).where(eq(layouts.id, id));
		expect(row?.version).toBe(1);
		expect(row?.html).toContain('{{brand.name}}');
	});

	it('knows no layout to replace that does not exist', async () => {
		const { admin, db } = await club();
		await expect(replaceLayout(db, admin, UNKNOWN_ID, FRAME, 1, APP_ORIGIN)).rejects.toBeInstanceOf(
			LayoutNotFoundError,
		);
	});

	it('deletes an unused layout and logs it', async () => {
		const setUp = await club();
		const { admin, db } = setUp;
		const id = await layoutNamed(setUp, 'Rahmen');
		await deleteLayout(db, admin, id);
		await expect(listLayouts(db, admin)).resolves.toStrictEqual([]);
		const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'layout.deleted'));
		expect(entries.map(({ target }) => target)).toStrictEqual([`layout:${id}`]);
		await expect(deleteLayout(db, admin, id)).rejects.toBeInstanceOf(LayoutNotFoundError);
	});

	it('refuses to delete a layout that templates use and says how many', async () => {
		const setUp = await club();
		const { admin, db } = setUp;
		const id = await layoutNamed(setUp, 'Rahmen');
		await useLayout(setUp, id, 'Eins');
		await useLayout(setUp, id, 'Zwei');
		await expect(deleteLayout(db, admin, id)).rejects.toMatchObject({
			name: 'LayoutInUseError',
			templates: 2,
		});
		await expect(deleteLayout(db, admin, id)).rejects.toBeInstanceOf(LayoutInUseError);
		const listed = await listLayouts(db, admin);
		expect(listed[0]?.usedBy).toBe(2);
	});
});
