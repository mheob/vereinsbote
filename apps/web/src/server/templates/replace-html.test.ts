import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { createArea } from '@/server/areas/areas';
import { setUpClub, userWith } from '@/server/contacts/testing';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';

import {
	TemplateChangedError,
	TemplateInvalidError,
	TemplateNotFoundError,
	TemplateNotHtmlError,
} from './errors';
import { replaceTemplateHtml } from './replace-html';
import { getTemplate } from './templates';
import { APP_ORIGIN, createTemplate } from './testing';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/**
 * A club with an editor and a reader of an area, and an HTML template and a block template there.
 *
 * @returns The club.
 */
async function club(): Promise<{
	db: Awaited<ReturnType<typeof createTestDb>>;
	editor: Awaited<ReturnType<typeof userWith>>;
	reader: Awaited<ReturnType<typeof userWith>>;
	htmlId: string;
	blocksId: string;
}> {
	const db = await createTestDb();
	const { admin } = await setUpClub(db);
	const { areaId } = await createArea(db, admin, 'Veranstaltungen');
	const editor = await userWith(db, { [areaId]: 'edit' });
	const reader = await userWith(db, { [areaId]: 'read' });
	const base = {
		preheader: 'Vorschau',
		salutationForm: 'du',
		salutationTexts: DEFAULT_SALUTATIONS.du,
		subject: 'Betreff',
	} as const;
	const { id: htmlId } = await createTemplate(db, editor, areaId, {
		...base,
		body: { html: '<p>Alt</p>', kind: 'html' },
		name: 'Brief',
	});
	const { id: blocksId } = await createTemplate(db, editor, areaId, {
		...base,
		body: { blocks: [], kind: 'blocks', layout: { kind: 'standard' } },
		name: 'Bausteine',
	});
	return { blocksId, db, editor, htmlId, reader };
}

describe('replacing the HTML of a template', () => {
	it('replaces the cleaned HTML, keeps the rest and counts the version up', async () => {
		const { db, editor, htmlId } = await club();
		const saved = await replaceTemplateHtml(
			db,
			editor,
			htmlId,
			'<p>Neu {{salutation}}</p><script>x()</script>',
			1,
			APP_ORIGIN,
		);
		expect(saved).toStrictEqual({ version: 2 });
		const record = await getTemplate(db, editor, htmlId);
		expect(record).toMatchObject({ name: 'Brief', preheader: 'Vorschau', subject: 'Betreff' });
		expect(record.body.kind).toBe('html');
		expect(JSON.stringify(record.body)).toContain('Neu {{salutation}}');
		expect(JSON.stringify(record.body)).not.toContain('script');
	});

	it('refuses an old version and a reader', async () => {
		const { db, editor, htmlId, reader } = await club();
		await expect(
			replaceTemplateHtml(db, editor, htmlId, '<p>x</p>', 5, APP_ORIGIN),
		).rejects.toBeInstanceOf(TemplateChangedError);
		await expect(
			replaceTemplateHtml(db, reader, htmlId, '<p>x</p>', 1, APP_ORIGIN),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it('refuses a block template and an unknown template', async () => {
		const { blocksId, db, editor } = await club();
		await expect(
			replaceTemplateHtml(db, editor, blocksId, '<p>x</p>', 1, APP_ORIGIN),
		).rejects.toBeInstanceOf(TemplateNotHtmlError);
		await expect(
			replaceTemplateHtml(db, editor, UNKNOWN_ID, '<p>x</p>', 1, APP_ORIGIN),
		).rejects.toBeInstanceOf(TemplateNotFoundError);
	});

	it('refuses HTML that does not pass the save checks and keeps the old one', async () => {
		const { db, editor, htmlId } = await club();
		await expect(
			replaceTemplateHtml(db, editor, htmlId, '<p>{{contact.birthDate}}</p>', 1, APP_ORIGIN),
		).rejects.toBeInstanceOf(TemplateInvalidError);
		const record = await getTemplate(db, editor, htmlId);
		expect(record.version).toBe(1);
	});
});
