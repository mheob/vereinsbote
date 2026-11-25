import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { createArea } from '@/server/areas/areas';
import { setFieldAreas } from '@/server/contacts/settings';
import { setUpClub, userWith } from '@/server/contacts/testing';
import { templates } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import type { ImportFinding, ImportResult } from '@/server/html-import/import-html';
import { storeImage } from '@/server/media/media';
import { pngBytes } from '@/server/media/testing';
import { ForbiddenError } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';

import { TemplateNotFoundError } from './errors';
import { checkHtmlImport } from './import-check';
import type { ImportCheckRequest } from './import-check';
import { APP_ORIGIN, createTemplate } from './testing';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const PNG_LENGTH = 100;
const DIRTY = '<p onclick="x()">Hallo {{salutation}}</p><script>alert(1)</script>';

type Club = Awaited<ReturnType<typeof club>>;

/**
 * Checks an import in the tests' app.
 *
 * @param user Who imports.
 * @param db The database.
 * @param request The HTML and its target.
 * @returns The result.
 */
async function check(
	db: Club['db'],
	user: Club['editor'],
	request: ImportCheckRequest,
): ReturnType<typeof checkHtmlImport> {
	return checkHtmlImport(db, user, request, APP_ORIGIN);
}

/**
 * The HTML of a successful check.
 *
 * @param result The result.
 * @returns The cleaned HTML; an empty text for a refusal.
 */
function cleanedHtml(result: Readonly<ImportResult>): string {
	return result.ok ? result.html : '';
}

/**
 * The findings of a successful check.
 *
 * @param result The result.
 * @returns The findings; none for a refusal.
 */
function findingsOf(result: Readonly<ImportResult>): readonly ImportFinding[] {
	return result.ok ? result.findings : [];
}

/**
 * A club with an editor and a reader of the area "Veranstaltungen".
 *
 * @returns The club.
 */
async function club(): Promise<{
	db: Awaited<ReturnType<typeof createTestDb>>;
	admin: Awaited<ReturnType<typeof setUpClub>>['admin'];
	editor: Awaited<ReturnType<typeof userWith>>;
	reader: Awaited<ReturnType<typeof userWith>>;
	areaId: string;
	otherAreaId: string;
}> {
	const db = await createTestDb();
	const { admin } = await setUpClub(db);
	const { areaId } = await createArea(db, admin, 'Veranstaltungen');
	const { areaId: otherAreaId } = await createArea(db, admin, 'Sport');
	const editor = await userWith(db, { [areaId]: 'edit', [otherAreaId]: 'edit' });
	const reader = await userWith(db, { [areaId]: 'read' });
	return { admin, areaId, db, editor, otherAreaId, reader };
}

describe('checking HTML for an import', () => {
	it('cleans the HTML of a template and reports what it removed', async () => {
		const { areaId, db, editor } = await club();
		const result = await check(db, editor, { areaId, html: DIRTY, target: 'template' });
		expect(result.ok).toBe(true);
		expect(cleanedHtml(result)).toContain('{{salutation}}');
		expect(cleanedHtml(result)).not.toContain('script');
		expect(findingsOf(result)).toContainEqual({ count: 1, kind: 'removed', what: 'script' });
	});

	it('stores nothing', async () => {
		const { areaId, db, editor } = await club();
		await check(db, editor, { areaId, html: DIRTY, target: 'template' });
		await expect(db.select().from(templates)).resolves.toStrictEqual([]);
	});

	it('needs edit in the area, which a reader and the admin role alone lack', async () => {
		const { admin, areaId, db, reader } = await club();
		const request = { areaId, html: DIRTY, target: 'template' } as const;
		await expect(check(db, reader, request)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(check(db, admin, request)).rejects.toBeInstanceOf(ForbiddenError);
	});

	it('takes the area of an existing template', async () => {
		const { areaId, db, editor, reader } = await club();
		const { id } = await createTemplate(db, editor, areaId, {
			body: { html: '<p>Hallo</p>', kind: 'html' },
			name: 'Brief',
			preheader: '',
			salutationForm: 'du',
			salutationTexts: DEFAULT_SALUTATIONS.du,
			subject: 'Betreff',
		});
		const request = { html: DIRTY, target: 'template', templateId: id } as const;
		await expect(check(db, editor, request)).resolves.toMatchObject({ ok: true });
		await expect(check(db, reader, request)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(check(db, editor, { ...request, templateId: UNKNOWN_ID })).rejects.toBeInstanceOf(
			TemplateNotFoundError,
		);
	});

	it('saves what it accepts: an HTML mail of about 300 KB, above the 256 KB of the click editor', async () => {
		const { areaId, db, editor } = await club();
		const html = `<html><body>${'<p>Hallo Welt, ein Absatz.</p>'.repeat(11_000)}</body></html>`;
		const checked = await check(db, editor, { areaId, html, target: 'template' });
		expect(checked).toMatchObject({ ok: true });
		const { id } = await createTemplate(db, editor, areaId, {
			body: { html: cleanedHtml(checked), kind: 'html' },
			name: 'Gross',
			preheader: '',
			salutationForm: 'du',
			salutationTexts: DEFAULT_SALUTATIONS.du,
			subject: 'Betreff',
		});
		expect(id).toHaveLength(36);
	});

	it('refuses placeholders the area does not see, in a template and in its own layout', async () => {
		const { areaId, db, editor } = await club();
		const refused = {
			ok: false,
			refusals: [{ key: 'contact.birthDate', kind: 'placeholderForbidden' }],
		};
		await expect(
			check(db, editor, { areaId, html: '<p>{{contact.birthDate}}</p>', target: 'template' }),
		).resolves.toStrictEqual(refused);
		await expect(
			check(db, editor, {
				areaId,
				html: '<p>{{contact.birthDate}}</p><div>{{content}}</div>',
				target: 'ownLayout',
			}),
		).resolves.toStrictEqual(refused);
	});

	it('lets the own layout of a template use {{content}}, which a template may not', async () => {
		const { areaId, db, editor } = await club();
		const html = '<div>{{content}}</div>';
		await expect(check(db, editor, { areaId, html, target: 'ownLayout' })).resolves.toMatchObject({
			ok: true,
		});
		await expect(check(db, editor, { areaId, html, target: 'template' })).resolves.toMatchObject({
			ok: false,
		});
	});

	it('knows the protected fields an area sees', async () => {
		const { admin, areaId, db, editor } = await club();
		await setFieldAreas(db, admin, { areaIds: [areaId], fieldKey: 'birthDate', kind: 'member' });
		await expect(
			check(db, editor, { areaId, html: '<p>{{contact.birthDate}}</p>', target: 'template' }),
		).resolves.toMatchObject({ ok: true });
	});

	it('refuses an image of the library of another area', async () => {
		const { areaId, db, editor, otherAreaId } = await club();
		const stored = await storeImage(
			db,
			createMemoryStorage(),
			editor,
			{ areaId: otherAreaId, purpose: 'library' },
			{ bytes: pngBytes(600, 300, PNG_LENGTH), name: 'bild.png' },
		);
		const html = `<img src="/media/${stored.id}.png" alt="Bild">`;
		await expect(check(db, editor, { areaId, html, target: 'template' })).resolves.toStrictEqual({
			ok: false,
			refusals: [{ kind: 'mediaForeign', mediaId: stored.id }],
		});
		await expect(
			check(db, editor, { areaId: otherAreaId, html, target: 'template' }),
		).resolves.toMatchObject({ ok: true });
	});

	it('checks a global layout for the admin only, with base fields and {{content}}', async () => {
		const { admin, db, editor } = await club();
		const request = {
			html: '<div><p>{{brand.name}}</p>{{content}}</div>',
			target: 'globalLayout',
		} as const;
		await expect(check(db, admin, request)).resolves.toMatchObject({ ok: true });
		await expect(check(db, editor, request)).rejects.toBeInstanceOf(ForbiddenError);
	});

	it('refuses a global layout without {{content}}', async () => {
		const { admin, db } = await club();
		await expect(
			check(db, admin, { html: '<p>Kein Inhalt</p>', target: 'globalLayout' }),
		).resolves.toStrictEqual({ ok: false, refusals: [{ kind: 'contentMissing' }] });
	});

	it('needs a template or an area', async () => {
		const { db, editor } = await club();
		await expect(check(db, editor, { html: DIRTY, target: 'template' })).rejects.toBeInstanceOf(
			TypeError,
		);
	});
});
