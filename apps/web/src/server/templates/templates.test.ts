import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { collectMediaIds } from '@/mail/blocks/block-schema';
import type { Block } from '@/mail/blocks/block-schema';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { starterTemplate } from '@/mail/starters/starters';
import type { TemplateInput, TemplateLayout } from '@/mail/templates/template-schema';
import { createArea } from '@/server/areas/areas';
import { UnknownAreaError } from '@/server/contacts/errors';
import { setFieldAreas } from '@/server/contacts/settings';
import { setUpClub, userWith } from '@/server/contacts/testing';
import { areas, auditLog, layouts, media, templateMedia, templates } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { storeImage } from '@/server/media/media';
import { pngBytes } from '@/server/media/testing';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';
import { StorageNotConfiguredError } from '@/server/storage/storage';
import type { ObjectStorage } from '@/server/storage/storage';

import {
	LayoutNotFoundError,
	TemplateChangedError,
	TemplateInvalidError,
	TemplateNameTakenError,
	TemplateNotFoundError,
} from './errors';
import {
	createFromStarter,
	createTemplate,
	deleteTemplate,
	duplicateTemplate,
	getTemplate,
	listLayoutChoices,
	listTemplates,
	saveTemplate,
} from './templates';
import type { TemplateRecord } from './templates';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const PNG_LENGTH = 100;

type Db = Awaited<ReturnType<typeof createTestDb>>;

interface Club {
	readonly db: Db;
	readonly storage: ObjectStorage;
	/** The admin of the setup, with `edit` in "Mitglieder". */
	readonly admin: Principal;
	/** `edit` in "Mitglieder" and "Veranstaltungen". */
	readonly editor: Principal;
	readonly membersAreaId: string;
	readonly partnersAreaId: string;
	readonly eventsAreaId: string;
}

/**
 * A club with the areas "Mitglieder", "Finanzen" and "Veranstaltungen" and an image storage.
 *
 * @returns The club.
 */
async function club(): Promise<Club> {
	const db = await createTestDb();
	const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
	const { areaId: eventsAreaId } = await createArea(db, admin, 'Veranstaltungen');
	const editor = await userWith(db, { [eventsAreaId]: 'edit', [membersAreaId]: 'edit' });
	return {
		admin,
		db,
		editor,
		eventsAreaId,
		membersAreaId,
		partnersAreaId,
		storage: createMemoryStorage(),
	};
}

const heading = (id: string, value: string): Block => ({
	content: [{ text: value, type: 'text' }],
	id,
	level: 1,
	type: 'heading',
});

const placeholderHeading = (id: string, key: string): Block => ({
	content: [{ attrs: { fallback: null, key }, type: 'placeholder' }],
	id,
	level: 2,
	type: 'heading',
});

const imageBlock = (mediaId: string, id = 'i'): Block => ({
	alt: 'Vereinsheim',
	decorative: false,
	href: null,
	id,
	mediaId,
	type: 'image',
});

const STANDARD: TemplateLayout = { kind: 'standard' };
const BIRTH_DATE_HEADING = placeholderHeading('h', 'contact.birthDate');
const BIRTH_DATE_FORBIDDEN = {
	problems: [{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'block.h' }],
};

/**
 * A valid template input.
 *
 * @param overrides The fields to change.
 * @returns The input.
 */
function input(overrides: Partial<TemplateInput> = {}): TemplateInput {
	return {
		body: { blocks: [heading('h', 'Sommerfest')], kind: 'blocks', layout: STANDARD },
		name: 'Sommerfest',
		preheader: 'Am Samstag im Vereinsheim',
		salutationForm: 'du',
		salutationTexts: DEFAULT_SALUTATIONS.du,
		subject: 'Einladung zum Sommerfest',
		...overrides,
	};
}

/**
 * A valid template input with the given name.
 *
 * @param value The name.
 * @returns The input.
 */
function named(value: string): TemplateInput {
	return input({ name: value });
}

/**
 * A valid template input with the given blocks.
 *
 * @param blocks The blocks.
 * @param layout The layout.
 * @returns The input.
 */
function withBlocks(blocks: readonly Block[], layout: TemplateLayout = STANDARD): TemplateInput {
	return input({ body: { blocks, kind: 'blocks', layout } });
}

/**
 * The HTML of a body.
 *
 * @param body The body.
 * @returns The HTML of an HTML template; an empty text for blocks.
 */
function htmlOfBody(body: TemplateInput['body']): string {
	return body.kind === 'html' ? body.html : '';
}

/**
 * Uploads a library image to an area.
 *
 * @param setUp The club.
 * @param areaId The area.
 * @returns The id of the image.
 */
async function libraryImage(setUp: Club, areaId: string): Promise<string> {
	const uploader = await userWith(setUp.db, { [areaId]: 'edit' });
	const record = await storeImage(
		setUp.db,
		setUp.storage,
		uploader,
		{ areaId, purpose: 'library' },
		{ bytes: pngBytes(600, 300, PNG_LENGTH), name: 'vereinsheim.png' },
	);
	return record.id;
}

/**
 * Creates a template in "Mitglieder" that shows an image of its library.
 *
 * @param setUp The club.
 * @param blocks Blocks before the image.
 * @returns The ids of the template and the image.
 */
async function templateWithImage(
	setUp: Club,
	blocks: readonly Block[] = [],
): Promise<{ id: string; imageId: string }> {
	const imageId = await libraryImage(setUp, setUp.membersAreaId);
	const template = withBlocks([...blocks, imageBlock(imageId)]);
	const { id } = await createTemplate(setUp.db, setUp.editor, setUp.membersAreaId, template);
	return { id, imageId };
}

/**
 * Inserts a global layout.
 *
 * @param db The database.
 * @param name Its name.
 * @returns Its id and name.
 */
async function insertLayout(db: Db, name: string): Promise<{ id: string; name: string }> {
	const [row] = await db
		.insert(layouts)
		.values({ html: '<div>{{content}}</div>', name })
		.returning({ id: layouts.id, name: layouts.name });
	if (row === undefined) throw new Error('Inserting the layout returned no row.');
	return row;
}

/**
 * The images a template shows.
 *
 * @param record The template.
 * @returns The media ids.
 */
function imagesOf(record: TemplateRecord): string[] {
	return record.body.kind === 'blocks' ? collectMediaIds(record.body.blocks) : [];
}

/**
 * The only image a template shows.
 *
 * @param record The template.
 * @returns Its media id.
 */
function onlyImageOf(record: TemplateRecord): string {
	const [only, ...others] = imagesOf(record);
	if (only === undefined || others.length > 0) throw new Error('Not exactly one image.');
	return only;
}

/**
 * Waits for a promise that must reject.
 *
 * @param promise The promise.
 * @returns The rejection reason.
 */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('The promise resolved.');
}

/**
 * The audit entries of an action.
 *
 * @param db The database.
 * @param action The action.
 * @returns The target and details of each entry.
 */
async function auditOf(
	db: Db,
	action: typeof auditLog.$inferSelect.action,
): Promise<{ target: string | null; details: unknown }[]> {
	return db
		.select({ details: auditLog.details, target: auditLog.target })
		.from(auditLog)
		.where(eq(auditLog.action, action));
}

/**
 * The ids of the stored images.
 *
 * @param db The database.
 * @returns The rows with their id only.
 */
async function mediaIds(db: Db): Promise<{ id: string }[]> {
	return db.select({ id: media.id }).from(media);
}

/**
 * A storage that notes the key of every write.
 *
 * @param storage The storage written to.
 * @returns The watching storage and the keys it wrote.
 */
function watchWrites(storage: ObjectStorage): { watched: ObjectStorage; written: string[] } {
	const written: string[] = [];
	const watched: ObjectStorage = {
		...storage,
		async put(key, bytes, options) {
			written.push(key);
			await storage.put(key, bytes, options);
		},
	};
	return { watched, written };
}

describe('templates by area rights', () => {
	it('creates and reads templates for the readers of the area', async () => {
		const c = await club();
		const reader = await userWith(c.db, { [c.membersAreaId]: 'read' });
		const created = input({ name: '  Sommerfest  ' });
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, created);
		const record = await getTemplate(c.db, reader, id);
		expect(record).toMatchObject({
			...input(),
			areaId: c.membersAreaId,
			id,
			name: 'Sommerfest',
			updatedByName: 'Test User',
			version: 1,
		});
		expect(record.updatedAt).toBeInstanceOf(Date);
		await expect(listTemplates(c.db, reader)).resolves.toStrictEqual([
			{
				areaId: c.membersAreaId,
				bodyKind: 'blocks',
				id,
				name: 'Sommerfest',
				updatedAt: record.updatedAt,
				version: 1,
			},
		]);
	});

	it('shows nothing to users without read in the area, admins included', async () => {
		const c = await club();
		const outsider = await userWith(c.db, { [c.partnersAreaId]: 'send' });
		const adminWithoutArea = await userWith(c.db, {}, { isAdmin: true });
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input());
		await expect(listTemplates(c.db, outsider)).resolves.toStrictEqual([]);
		await expect(listTemplates(c.db, adminWithoutArea)).resolves.toStrictEqual([]);
		await expect(getTemplate(c.db, outsider, id)).rejects.toThrow(ForbiddenError);
		await expect(getTemplate(c.db, adminWithoutArea, id)).rejects.toThrow(ForbiddenError);
	});

	it('lets readers change nothing', async () => {
		const c = await club();
		const reader = await userWith(c.db, { [c.eventsAreaId]: 'read', [c.membersAreaId]: 'read' });
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input());
		const other = input({ name: 'Herbstfest' });
		await expect(createTemplate(c.db, reader, c.membersAreaId, other)).rejects.toThrow(
			ForbiddenError,
		);
		await expect(saveTemplate(c.db, reader, id, other, 1)).rejects.toThrow(ForbiddenError);
		await expect(deleteTemplate(c.db, reader, id, 1)).rejects.toThrow(ForbiddenError);
		await expect(
			duplicateTemplate(c.db, c.storage, reader, id, c.eventsAreaId, 'Kopie'),
		).rejects.toThrow(ForbiddenError);
	});

	it('lists the templates of every readable area by name', async () => {
		const c = await club();
		const reader = await userWith(c.db, { [c.eventsAreaId]: 'read', [c.membersAreaId]: 'send' });
		await createTemplate(c.db, c.editor, c.membersAreaId, input({ name: 'b-Vorlage' }));
		await createTemplate(c.db, c.editor, c.eventsAreaId, input({ name: 'A-Vorlage' }));
		await createTemplate(c.db, c.admin, c.membersAreaId, input({ name: 'C-Vorlage' }));
		const listed = await listTemplates(c.db, reader);
		expect(listed.map(({ name }) => name)).toStrictEqual(['A-Vorlage', 'b-Vorlage', 'C-Vorlage']);
	});

	it('logs ids and the area, never content', async () => {
		const c = await club();
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input());
		await saveTemplate(c.db, c.editor, id, input({ subject: 'Neuer Betreff' }), 1);
		await deleteTemplate(c.db, c.editor, id, 2);
		const entry = [{ details: { areaId: c.membersAreaId }, target: `template:${id}` }];
		await expect(auditOf(c.db, 'template.created')).resolves.toStrictEqual(entry);
		await expect(auditOf(c.db, 'template.updated')).resolves.toStrictEqual(entry);
		await expect(auditOf(c.db, 'template.deleted')).resolves.toStrictEqual(entry);
	});

	it('refuses unknown templates', async () => {
		const c = await club();
		await expect(getTemplate(c.db, c.editor, UNKNOWN_ID)).rejects.toThrow(TemplateNotFoundError);
		await expect(saveTemplate(c.db, c.editor, UNKNOWN_ID, input(), 1)).rejects.toThrow(
			TemplateNotFoundError,
		);
		await expect(deleteTemplate(c.db, c.editor, UNKNOWN_ID, 1)).rejects.toThrow(
			TemplateNotFoundError,
		);
		await expect(
			duplicateTemplate(c.db, c.storage, c.editor, UNKNOWN_ID, c.eventsAreaId, 'Kopie'),
		).rejects.toThrow(TemplateNotFoundError);
	});

	it('refuses a template in an area that is gone', async () => {
		const c = await club();
		const { areaId } = await createArea(c.db, c.admin, 'Archiv');
		const archivist = await userWith(c.db, { [areaId]: 'edit' });
		await c.db.delete(areas).where(eq(areas.id, areaId));
		await expect(createTemplate(c.db, archivist, areaId, input())).rejects.toThrow(
			UnknownAreaError,
		);
	});
});

describe(saveTemplate, () => {
	it('refuses a stale version and keeps the newer text', async () => {
		const c = await club();
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input());
		const first = input({ subject: 'Aus dem ersten Tab' });
		const second = input({ subject: 'Aus dem zweiten Tab' });
		await expect(saveTemplate(c.db, c.editor, id, first, 1)).resolves.toStrictEqual({
			version: 2,
		});
		await expect(saveTemplate(c.db, c.editor, id, second, 1)).rejects.toThrow(TemplateChangedError);
		await expect(deleteTemplate(c.db, c.editor, id, 1)).rejects.toThrow(TemplateChangedError);
		await expect(getTemplate(c.db, c.editor, id)).resolves.toMatchObject({
			subject: 'Aus dem ersten Tab',
			version: 2,
		});
	});

	it('reports a placeholder that the field protection no longer allows', async () => {
		const c = await club();
		const template = withBlocks([BIRTH_DATE_HEADING]);
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, template);
		await setFieldAreas(c.db, c.admin, {
			areaIds: [c.partnersAreaId],
			fieldKey: 'birthDate',
			kind: 'member',
		});
		const error = await failureOf(saveTemplate(c.db, c.editor, id, template, 1));
		expect(error).toBeInstanceOf(TemplateInvalidError);
		expect(error).toMatchObject(BIRTH_DATE_FORBIDDEN);
		await expect(getTemplate(c.db, c.editor, id)).resolves.toMatchObject({ version: 1 });
	});

	it('stores the cleaned HTML of an import', async () => {
		const c = await club();
		const html = input({
			body: {
				html: '<p onclick="x()">Hallo {{salutation}}</p><script>alert(1)</script>',
				kind: 'html',
			},
		});
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, html);
		const stored = await getTemplate(c.db, c.editor, id);
		expect(stored.body).toStrictEqual({
			html: "<!DOCTYPE html><html lang='de'><head></head><body><p>Hallo {{salutation}}</p></body></html>",
			kind: 'html',
		});
	});

	it('reports a placeholder in an HTML template that the field protection no longer allows', async () => {
		const c = await club();
		const html = input({ body: { html: '<p>Zum {{contact.birthDate}}</p>', kind: 'html' } });
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, html);
		await setFieldAreas(c.db, c.admin, {
			areaIds: [c.partnersAreaId],
			fieldKey: 'birthDate',
			kind: 'member',
		});
		const error = await failureOf(saveTemplate(c.db, c.editor, id, html, 1));
		expect(error).toBeInstanceOf(TemplateInvalidError);
		expect(error).toMatchObject({
			problems: [{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'html' }],
		});
	});

	it('refuses input that does not pass the schema', async () => {
		const c = await club();
		const button: Block = {
			align: 'left',
			href: 'http://example.org',
			id: 'b',
			label: [{ text: 'Los', type: 'text' }],
			type: 'button',
		};
		const template = withBlocks([button]);
		await expect(createTemplate(c.db, c.editor, c.membersAreaId, template)).rejects.toThrow();
		await expect(c.db.select().from(templates)).resolves.toStrictEqual([]);
	});

	it('refuses a second template with the same name in the area, case-insensitive', async () => {
		const c = await club();
		await createTemplate(c.db, c.editor, c.membersAreaId, named('Sommerfest'));
		await expect(
			createTemplate(c.db, c.editor, c.membersAreaId, named(' SOMMERFEST ')),
		).rejects.toThrow(TemplateNameTakenError);
		await expect(
			createTemplate(c.db, c.editor, c.eventsAreaId, named('Sommerfest')),
		).resolves.toStrictEqual({ id: expect.any(String) as unknown });
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, named('Herbstfest'));
		await expect(saveTemplate(c.db, c.editor, id, named('sommerfest'), 1)).rejects.toThrow(
			TemplateNameTakenError,
		);
		await expect(
			duplicateTemplate(c.db, c.storage, c.editor, id, c.membersAreaId, 'Sommerfest'),
		).rejects.toThrow(TemplateNameTakenError);
	});
});

describe('layouts of templates', () => {
	it('lists the global layouts by name, with their HTML for the preview', async () => {
		const c = await club();
		const festive = await insertLayout(c.db, 'Festlich');
		const formal = await insertLayout(c.db, 'amtlich');
		const html = '<div>{{content}}</div>';
		await expect(listLayoutChoices(c.db)).resolves.toStrictEqual([
			{ ...formal, html },
			{ ...festive, html },
		]);
	});

	it('keeps a shared layout while a template uses it', async () => {
		const c = await club();
		const festive = await insertLayout(c.db, 'Festlich');
		const shared: TemplateLayout = { kind: 'shared', layoutId: festive.id };
		const blocks = [heading('h', 'Sommerfest')];
		const template = withBlocks(blocks, shared);
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, template);
		const layoutOf = async (): Promise<unknown> =>
			c.db
				.select({ sharedLayoutId: templates.sharedLayoutId })
				.from(templates)
				.where(eq(templates.id, id));
		const deleteLayout = async (): Promise<unknown> =>
			c.db.delete(layouts).where(eq(layouts.id, festive.id));
		await expect(layoutOf()).resolves.toStrictEqual([{ sharedLayoutId: festive.id }]);
		await expect(getTemplate(c.db, c.editor, id)).resolves.toMatchObject({
			body: { layout: shared },
		});
		await expect(deleteLayout()).rejects.toThrow();
		await saveTemplate(c.db, c.editor, id, withBlocks(blocks), 1);
		await expect(layoutOf()).resolves.toStrictEqual([{ sharedLayoutId: null }]);
		await expect(deleteLayout()).resolves.toBeDefined();
	});

	it('refuses a layout that is gone', async () => {
		const c = await club();
		const shared: TemplateLayout = { kind: 'shared', layoutId: UNKNOWN_ID };
		const template = withBlocks([heading('h', 'Sommerfest')], shared);
		await expect(createTemplate(c.db, c.editor, c.membersAreaId, template)).rejects.toThrow(
			LayoutNotFoundError,
		);
	});
});

describe('images of templates', () => {
	it('tracks images and blocks deleting a used one', async () => {
		const c = await club();
		const { id, imageId } = await templateWithImage(c);
		const deleteImage = async (): Promise<unknown> =>
			c.db.delete(media).where(eq(media.id, imageId));
		await expect(c.db.select().from(templateMedia)).resolves.toStrictEqual([
			{ mediaId: imageId, templateId: id },
		]);
		await expect(deleteImage()).rejects.toThrow();
		await saveTemplate(c.db, c.editor, id, input(), 1);
		await expect(c.db.select().from(templateMedia)).resolves.toStrictEqual([]);
		await expect(deleteImage()).resolves.toBeDefined();
	});

	it('tracks the images of an HTML template and of an own layout', async () => {
		const c = await club();
		const bodyImage = await libraryImage(c, c.membersAreaId);
		const layoutImage = await libraryImage(c, c.membersAreaId);
		const body = {
			html: `<img src="/media/${bodyImage}.png" alt="a"><p>x</p>`,
			kind: 'html',
		} as const;
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input({ body }));
		const own = {
			blocks: [],
			kind: 'blocks',
			layout: {
				html: `<img src="/media/${layoutImage}.png" alt="b"><div>{{content}}</div>`,
				kind: 'own',
			},
		} as const;
		const other = await createTemplate(
			c.db,
			c.editor,
			c.membersAreaId,
			input({ body: own, name: 'Eigenes Layout' }),
		);
		const rows = await c.db.select().from(templateMedia);
		expect(rows).toHaveLength(2);
		expect(rows).toContainEqual({ mediaId: bodyImage, templateId: id });
		expect(rows).toContainEqual({ mediaId: layoutImage, templateId: other.id });
		await expect(c.db.delete(media).where(eq(media.id, bodyImage))).rejects.toThrow();
		await expect(c.db.delete(media).where(eq(media.id, layoutImage))).rejects.toThrow();
	});

	it('releases the image of an HTML template when the template stops using it', async () => {
		const c = await club();
		const imageId = await libraryImage(c, c.membersAreaId);
		const body = { html: `<img src="/media/${imageId}.png" alt="a">`, kind: 'html' } as const;
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input({ body }));
		await saveTemplate(c.db, c.editor, id, input(), 1);
		await expect(c.db.delete(media).where(eq(media.id, imageId))).resolves.toBeDefined();
	});

	it('knows an image written with the address of the app as an image of the area (R23)', async () => {
		const c = await club();
		const imageId = await libraryImage(c, c.membersAreaId);
		const origin = 'https://verein.example.org';
		const body = {
			html: `<img src="${origin}/media/${imageId}.png" alt="a">`,
			kind: 'html',
		} as const;
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input({ body }), origin);
		await expect(c.db.select().from(templateMedia)).resolves.toStrictEqual([
			{ mediaId: imageId, templateId: id },
		]);
		await expect(c.db.delete(media).where(eq(media.id, imageId))).rejects.toThrow();
	});

	it('refuses the address of the app with an image of another area (R23)', async () => {
		const c = await club();
		const imageId = await libraryImage(c, c.eventsAreaId);
		const origin = 'https://verein.example.org';
		const body = {
			html: `<img src="${origin}/media/${imageId}.png" alt="">`,
			kind: 'html',
		} as const;
		const error = await failureOf(
			createTemplate(c.db, c.editor, c.membersAreaId, input({ body }), origin),
		);
		expect(error).toMatchObject({ problems: [{ kind: 'mediaForeign', mediaId: imageId }] });
	});

	it('refuses an image of another area in an HTML template', async () => {
		const c = await club();
		const imageId = await libraryImage(c, c.eventsAreaId);
		const body = { html: `<img src="/media/${imageId}.png" alt="">`, kind: 'html' } as const;
		const error = await failureOf(createTemplate(c.db, c.editor, c.membersAreaId, input({ body })));
		expect(error).toMatchObject({ problems: [{ kind: 'mediaForeign', mediaId: imageId }] });
	});

	it('refuses an image of another area', async () => {
		const c = await club();
		const imageId = await libraryImage(c, c.eventsAreaId);
		const template = withBlocks([imageBlock(imageId)]);
		const error = await failureOf(createTemplate(c.db, c.editor, c.membersAreaId, template));
		expect(error).toBeInstanceOf(TemplateInvalidError);
		expect(error).toMatchObject({ problems: [{ kind: 'mediaForeign', mediaId: imageId }] });
	});

	it('drops the image links of a deleted template', async () => {
		const c = await club();
		const { id } = await templateWithImage(c);
		await deleteTemplate(c.db, c.editor, id, 1);
		await expect(c.db.select().from(templateMedia)).resolves.toStrictEqual([]);
		await expect(getTemplate(c.db, c.editor, id)).rejects.toThrow(TemplateNotFoundError);
		await expect(deleteTemplate(c.db, c.editor, id, 1)).rejects.toThrow(TemplateNotFoundError);
	});
});

describe(duplicateTemplate, () => {
	it('duplicates into another area with copies of the images', async () => {
		const c = await club();
		const { id, imageId } = await templateWithImage(c, [heading('h', 'Sommerfest')]);
		const copier = await userWith(c.db, { [c.eventsAreaId]: 'edit', [c.membersAreaId]: 'read' });
		const duplicated = await duplicateTemplate(
			c.db,
			c.storage,
			copier,
			id,
			c.eventsAreaId,
			' Sommerfest ',
		);
		const copy = await getTemplate(c.db, c.editor, duplicated.id);
		const copiedImage = onlyImageOf(copy);
		expect(copy).toMatchObject({
			areaId: c.eventsAreaId,
			name: 'Sommerfest',
			preheader: 'Am Samstag im Vereinsheim',
			subject: 'Einladung zum Sommerfest',
			version: 1,
		});
		await expect(c.db.select().from(media).where(eq(media.id, copiedImage))).resolves.toMatchObject(
			[
				{
					areaId: c.eventsAreaId,
					bytes: PNG_LENGTH,
					createdByUserId: copier.userId,
					height: 300,
					name: 'vereinsheim.png',
					purpose: 'library',
					type: 'png',
					width: 600,
				},
			],
		);
		await expect(c.storage.get(`media/${copiedImage}`)).resolves.toMatchObject({
			contentType: 'image/png',
			size: PNG_LENGTH,
		});
		await expect(
			c.db.select().from(templateMedia).where(eq(templateMedia.templateId, duplicated.id)),
		).resolves.toStrictEqual([{ mediaId: copiedImage, templateId: duplicated.id }]);
		const original = await getTemplate(c.db, c.editor, id);
		expect(imagesOf(original)).toStrictEqual([imageId]);
	});

	it('logs the copy with its source', async () => {
		const c = await club();
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input());
		const copy = await duplicateTemplate(c.db, c.storage, c.editor, id, c.eventsAreaId, 'Kopie');
		await expect(auditOf(c.db, 'template.duplicated')).resolves.toStrictEqual([
			{ details: { areaId: c.eventsAreaId, sourceTemplateId: id }, target: `template:${copy.id}` },
		]);
	});

	it('shares the images within the area', async () => {
		const c = await club();
		const { id, imageId } = await templateWithImage(c);
		const copy = await duplicateTemplate(c.db, null, c.editor, id, c.membersAreaId, 'Kopie');
		const record = await getTemplate(c.db, c.editor, copy.id);
		expect(imagesOf(record)).toStrictEqual([imageId]);
		await expect(mediaIds(c.db)).resolves.toStrictEqual([{ id: imageId }]);
	});

	it('needs read in the source area and edit in the target area', async () => {
		const c = await club();
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input());
		const sourceEditor = await userWith(c.db, { [c.membersAreaId]: 'edit' });
		const targetEditor = await userWith(c.db, { [c.eventsAreaId]: 'edit' });
		await expect(
			duplicateTemplate(c.db, c.storage, sourceEditor, id, c.eventsAreaId, 'Kopie'),
		).rejects.toThrow(ForbiddenError);
		await expect(
			duplicateTemplate(c.db, c.storage, targetEditor, id, c.eventsAreaId, 'Kopie'),
		).rejects.toThrow(ForbiddenError);
	});

	it('refuses to copy images without a storage', async () => {
		const c = await club();
		const withImage = await templateWithImage(c);
		const withoutImage = await createTemplate(
			c.db,
			c.editor,
			c.membersAreaId,
			input({ name: 'Ohne Bild' }),
		);
		await expect(
			duplicateTemplate(c.db, null, c.editor, withImage.id, c.eventsAreaId, 'Sommerfest'),
		).rejects.toThrow(StorageNotConfiguredError);
		await expect(
			duplicateTemplate(c.db, null, c.editor, withoutImage.id, c.eventsAreaId, 'Ohne Bild'),
		).resolves.toStrictEqual({ id: expect.any(String) as unknown });
	});

	it('copies the images of an HTML template into another area', async () => {
		const c = await club();
		const imageId = await libraryImage(c, c.membersAreaId);
		const body = {
			html: `<p>Hallo</p><img src="/media/${imageId}.png" alt="a">`,
			kind: 'html',
		} as const;
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, input({ body }));
		const duplicated = await duplicateTemplate(
			c.db,
			c.storage,
			c.editor,
			id,
			c.eventsAreaId,
			'Kopie',
		);
		const rows = await c.db
			.select()
			.from(templateMedia)
			.where(eq(templateMedia.templateId, duplicated.id));
		expect(rows).toHaveLength(1);
		const copiedImage = rows.map(({ mediaId }) => mediaId).join('');
		expect(copiedImage).not.toBe(imageId);
		const copy = await getTemplate(c.db, c.editor, duplicated.id);
		expect(htmlOfBody(copy.body)).toContain(`/media/${copiedImage}.png`);
		expect(htmlOfBody(copy.body)).not.toContain(imageId);
	});

	it('refuses to duplicate when a placeholder is not allowed in the target area', async () => {
		const c = await club();
		const { id, imageId } = await templateWithImage(c, [BIRTH_DATE_HEADING]);
		const error = await failureOf(
			duplicateTemplate(c.db, c.storage, c.editor, id, c.eventsAreaId, 'Sommerfest'),
		);
		expect(error).toBeInstanceOf(TemplateInvalidError);
		expect(error).toMatchObject(BIRTH_DATE_FORBIDDEN);
		await expect(c.db.select({ id: templates.id }).from(templates)).resolves.toStrictEqual([
			{ id },
		]);
		await expect(mediaIds(c.db)).resolves.toStrictEqual([{ id: imageId }]);
	});

	it('removes the copied images again when the copy cannot be saved', async () => {
		const c = await club();
		const { id, imageId } = await templateWithImage(c);
		await createTemplate(c.db, c.editor, c.eventsAreaId, input({ name: 'Belegt' }));
		const { watched, written } = watchWrites(c.storage);
		await expect(
			duplicateTemplate(c.db, watched, c.editor, id, c.eventsAreaId, 'Belegt'),
		).rejects.toThrow(TemplateNameTakenError);
		const left = await Promise.all(written.map(async (key) => c.storage.get(key)));
		expect(left).toStrictEqual([null]);
		await expect(mediaIds(c.db)).resolves.toStrictEqual([{ id: imageId }]);
	});

	it('removes the copies made so far when an image cannot be copied', async () => {
		const c = await club();
		const first = await libraryImage(c, c.membersAreaId);
		const second = await libraryImage(c, c.membersAreaId);
		const template = withBlocks([imageBlock(first, 'a'), imageBlock(second, 'b')]);
		const { id } = await createTemplate(c.db, c.editor, c.membersAreaId, template);
		await c.storage.delete(`media/${second}`);
		const { watched, written } = watchWrites(c.storage);
		await expect(
			duplicateTemplate(c.db, watched, c.editor, id, c.eventsAreaId, 'Sommerfest'),
		).rejects.toThrow('A stored image is missing.');
		const left = await Promise.all(written.map(async (key) => c.storage.get(key)));
		expect(left).toStrictEqual([null]);
		await expect(mediaIds(c.db)).resolves.toHaveLength(2);
	});
});

describe(createFromStarter, () => {
	it('creates a template from the invitation with the given name and subject', async () => {
		const c = await club();
		const names = { name: 'Einladung Sommerfest', subject: 'Einladung zum Sommerfest' };
		const { id } = await createFromStarter(c.db, c.editor, c.eventsAreaId, 'invitation', names);
		const { body, preheader, salutationForm, salutationTexts } = starterTemplate('invitation');
		await expect(getTemplate(c.db, c.editor, id)).resolves.toMatchObject({
			...names,
			areaId: c.eventsAreaId,
			body,
			preheader,
			salutationForm,
			salutationTexts,
		});
	});
});
