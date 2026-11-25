import { describe, expect, it } from 'vite-plus/test';

import type { Block } from '@/mail/blocks/block-schema';
import { DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { setFieldAreas } from '@/server/contacts/settings';
import { setUpClub, userWith } from '@/server/contacts/testing';
import { layouts } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { storeImage } from '@/server/media/media';
import { pngBytes } from '@/server/media/testing';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';

import { loadTemplateEditorData } from './editor-data';
import { TemplateNotFoundError } from './errors';
import { createTemplate } from './templates';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const PNG_LENGTH = 100;
const IMAGE_WIDTH = 600;
const IMAGE_HEIGHT = 300;

type Db = Awaited<ReturnType<typeof createTestDb>>;

interface Club {
	readonly db: Db;
	readonly admin: Principal;
	readonly editor: Principal;
	readonly reader: Principal;
	readonly id: string;
	readonly imageId: string;
	readonly partnersAreaId: string;
}

const birthDateHeading: Block = {
	content: [{ attrs: { fallback: null, key: 'contact.birthDate' }, type: 'placeholder' }],
	id: 'h',
	level: 2,
	type: 'heading',
};

/**
 * A valid template with the given blocks.
 *
 * @param blocks The blocks.
 * @returns The input.
 */
function withBlocks(blocks: readonly Block[]): TemplateInput {
	return {
		body: { blocks, kind: 'blocks', layout: { kind: 'standard' } },
		name: 'Sommerfest',
		preheader: '',
		salutationForm: 'du',
		salutationTexts: DEFAULT_SALUTATIONS.du,
		subject: 'Einladung',
	};
}

/**
 * A club with an editor and a reader of the members area and a template there that shows a
 * library image and the birth date.
 *
 * @returns The database, the users and the ids.
 */
async function club(): Promise<Club> {
	const db = await createTestDb();
	const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
	const editor = await userWith(db, { [membersAreaId]: 'edit' });
	const reader = await userWith(db, { [membersAreaId]: 'read' });
	const image = await storeImage(
		db,
		createMemoryStorage(),
		editor,
		{ areaId: membersAreaId, purpose: 'library' },
		{ bytes: pngBytes(IMAGE_WIDTH, IMAGE_HEIGHT, PNG_LENGTH), name: 'vereinsheim.png' },
	);
	const imageBlock: Block = {
		alt: 'Vereinsheim',
		decorative: false,
		href: null,
		id: 'i',
		mediaId: image.id,
		type: 'image',
	};
	const { id } = await createTemplate(
		db,
		editor,
		membersAreaId,
		withBlocks([birthDateHeading, imageBlock]),
	);
	return { admin, db, editor, id, imageId: image.id, partnersAreaId, reader };
}

describe(loadTemplateEditorData, () => {
	it('loads a template with its area, its rights and the brand', async () => {
		const c = await club();
		const data = await loadTemplateEditorData(c.db, c.editor, c.id);
		expect(data.template).toMatchObject({ id: c.id, name: 'Sommerfest', version: 1 });
		expect(data).toMatchObject({ areaName: 'Mitglieder', brand: DEFAULT_BRAND, canEdit: true });
	});

	it('loads the global layouts with their HTML and the images of the blocks', async () => {
		const c = await club();
		const [layout] = await c.db
			.insert(layouts)
			.values({ html: '<div>{{content}}</div>', name: 'Festlich' })
			.returning({ id: layouts.id });
		const data = await loadTemplateEditorData(c.db, c.editor, c.id);
		expect(data.layouts).toStrictEqual([
			{ html: '<div>{{content}}</div>', id: layout?.id, name: 'Festlich' },
		]);
		expect(data.media).toStrictEqual({
			[c.imageId]: {
				height: IMAGE_HEIGHT,
				name: 'vereinsheim.png',
				type: 'png',
				width: IMAGE_WIDTH,
			},
		});
	});

	it('offers the placeholders of the area and finds no problem in a fresh template', async () => {
		const c = await club();
		const data = await loadTemplateEditorData(c.db, c.editor, c.id);
		expect(data.placeholders.map(({ key }) => key)).toContain('contact.birthDate');
		expect(data.problems).toStrictEqual([]);
	});

	it('gives a reader the template without the right to change it', async () => {
		const c = await club();
		const data = await loadTemplateEditorData(c.db, c.reader, c.id);
		expect(data.canEdit).toBe(false);
		expect(data.template.id).toBe(c.id);
	});

	it('reports a placeholder the area may no longer use at once', async () => {
		const c = await club();
		await setFieldAreas(c.db, c.admin, {
			areaIds: [c.partnersAreaId],
			fieldKey: 'birthDate',
			kind: 'member',
		});
		const data = await loadTemplateEditorData(c.db, c.editor, c.id);
		expect(data.problems).toStrictEqual([
			{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'block.h' },
		]);
		expect(data.placeholders.map(({ key }) => key)).not.toContain('contact.birthDate');
	});

	it('refuses users without read in the area and unknown templates', async () => {
		const c = await club();
		const outsider = await userWith(c.db, { [c.partnersAreaId]: 'edit' });
		await expect(loadTemplateEditorData(c.db, outsider, c.id)).rejects.toThrow(ForbiddenError);
		await expect(loadTemplateEditorData(c.db, c.admin, c.id)).resolves.toMatchObject({
			canEdit: true,
		});
		await expect(loadTemplateEditorData(c.db, c.editor, UNKNOWN_ID)).rejects.toThrow(
			TemplateNotFoundError,
		);
	});
});
