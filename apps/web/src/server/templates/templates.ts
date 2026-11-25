/*
 * The mail templates of the areas (Design 9). Reading needs `read` in the area, every change
 * `edit`; the admin role alone gives neither. Every write runs the save checks with the layout and
 * the images locked, compares the version under a row lock and records the images the template
 * shows, so an image in use cannot be deleted. The activity log names ids and the area, never
 * content.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { collectMediaIds } from '@/mail/blocks/block-schema';
import type { Block, ColumnBlock } from '@/mail/blocks/block-schema';
import { starterTemplate } from '@/mail/starters/starters';
import type { StarterId } from '@/mail/starters/starters';
import {
	salutationTextsSchema,
	templateBodySchema,
	templateInputSchema,
} from '@/mail/templates/template-schema';
import type { TemplateBody, TemplateInput, TemplateLayout } from '@/mail/templates/template-schema';
import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { UnknownAreaError } from '@/server/contacts/errors';
import type { Db } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { areas, layouts, media, templateMedia, templates, user } from '@/server/db/schema';
import { htmlMediaIds, swapHtmlMediaIds } from '@/server/html-import/media-refs';
import { mediaStorageKey, newMediaId } from '@/server/media/ids';
import { assertArea, canAccessArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { StorageNotConfiguredError } from '@/server/storage/storage';
import type { ObjectStorage } from '@/server/storage/storage';

import { allowedTemplatePlaceholders } from './allowed-placeholders';
import type { AllowedPlaceholders } from './allowed-placeholders';
import {
	LayoutNotFoundError,
	TemplateChangedError,
	TemplateInvalidError,
	TemplateNameTakenError,
	TemplateNotFoundError,
} from './errors';
import { checkTemplateForSave, prepareTemplateForSave } from './save-checks';

/** A stored template as its editor loads it. */
interface TemplateRecord extends TemplateInput {
	readonly id: string;
	readonly areaId: string;
	/** Sent back with a save or a deletion; a newer one refuses both. */
	readonly version: number;
	readonly updatedAt: Date;
	/** Null when that user no longer exists. */
	readonly updatedByName: string | null;
}

/** A template in the list. */
interface TemplateSummary {
	readonly id: string;
	readonly areaId: string;
	readonly name: string;
	readonly bodyKind: 'blocks' | 'html';
	readonly updatedAt: Date;
	/** Sent back with a deletion, so a template saved since the list loaded is not deleted unseen. */
	readonly version: number;
}

/** Who writes into which area, and what the area allows. */
interface WriteContext {
	readonly actor: Principal;
	readonly areaId: string;
	readonly allowed: AllowedPlaceholders;
}

/** The copy of each image of another area: source id to copy id. */
type ImageCopies = ReadonlyMap<string, string>;

/**
 * The images a body shows: those of its blocks, of its HTML and of its own HTML layout.
 *
 * @param body The body.
 * @returns The media ids, each once.
 */
function mediaIdsOf(body: TemplateBody): string[] {
	if (body.kind === 'html') return htmlMediaIds(body.html);
	const ids = collectMediaIds(body.blocks);
	return body.layout.kind === 'own'
		? [...new Set([...ids, ...htmlMediaIds(body.layout.html)])]
		: ids;
}

/**
 * The global layout a body uses.
 *
 * @param body The body.
 * @returns The id of the layout, or null for the standard layout, an own layout or HTML.
 */
function sharedLayoutIdOf(body: TemplateBody): string | null {
	return body.kind === 'blocks' && body.layout.kind === 'shared' ? body.layout.layoutId : null;
}

/**
 * Runs a write that may hit the unique index on the area and `lower(name)`.
 *
 * @param write The write.
 * @returns The result of the write.
 * @throws {TemplateNameTakenError} When another template of the area has the name.
 */
async function withUniqueName<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (isUniqueViolation(error)) throw new TemplateNameTakenError();
		throw error;
	}
}

/**
 * Makes sure the area exists and keeps it until the transaction ends.
 *
 * @param tx The transaction.
 * @param areaId The area.
 * @throws {UnknownAreaError} When the area does not exist (any more).
 */
async function lockArea(tx: Db, areaId: string): Promise<void> {
	const [row] = await tx
		.select({ id: areas.id })
		.from(areas)
		.where(eq(areas.id, areaId))
		.for('key share');
	if (row === undefined) throw new UnknownAreaError();
}

/**
 * Makes sure a chosen global layout exists and keeps it until the transaction ends.
 *
 * @param tx The transaction.
 * @param layoutId The layout, or null for none.
 * @throws {LayoutNotFoundError} When the layout does not exist (any more).
 */
async function lockLayout(tx: Db, layoutId: string | null): Promise<void> {
	if (layoutId === null) return;
	const [row] = await tx
		.select({ id: layouts.id })
		.from(layouts)
		.where(eq(layouts.id, layoutId))
		.for('key share');
	if (row === undefined) throw new LayoutNotFoundError();
}

/**
 * Finds which of the images belong to the area's library and keeps them until the transaction
 * ends, so a deletion in another tab waits.
 *
 * @param tx The transaction.
 * @param areaId The area.
 * @param ids The images.
 * @returns The ids of those that are library images of the area.
 */
async function lockAreaMedia(
	tx: Db,
	areaId: string,
	ids: readonly string[],
): Promise<ReadonlySet<string>> {
	if (ids.length === 0) return new Set();
	const rows = await tx
		.select({ id: media.id })
		.from(media)
		.where(and(inArray(media.id, [...ids]), eq(media.areaId, areaId)))
		.for('key share');
	return new Set(rows.map(({ id }) => id));
}

/**
 * Runs the save checks inside the write's transaction, with the layout and the images locked.
 *
 * @param tx The transaction.
 * @param context The area and its placeholders.
 * @param input The template.
 * @returns The template to store: the HTML of an import or an own layout is the cleaned HTML.
 * @throws {LayoutNotFoundError} When the chosen global layout is gone.
 * @throws {TemplateInvalidError} When the template does not pass the save checks.
 */
async function assertSavable(
	tx: Db,
	context: WriteContext,
	input: TemplateInput,
): Promise<TemplateInput> {
	await lockLayout(tx, sharedLayoutIdOf(input.body));
	const areaMediaIds = await lockAreaMedia(tx, context.areaId, mediaIdsOf(input.body));
	const checked = prepareTemplateForSave(input, context.allowed, areaMediaIds);
	if (checked.problems.length > 0) throw new TemplateInvalidError(checked.problems);
	return checked.input;
}

/**
 * The columns a save writes.
 *
 * @param input The template.
 * @param userId Who saves.
 * @returns The values; the name trimmed.
 */
function rowValues(
	input: TemplateInput,
	userId: string,
): Omit<typeof templates.$inferInsert, 'areaId'> {
	return {
		body: input.body,
		name: input.name.trim(),
		preheader: input.preheader,
		salutationForm: input.salutationForm,
		salutationTexts: input.salutationTexts,
		sharedLayoutId: sharedLayoutIdOf(input.body),
		subject: input.subject,
		updatedAt: new Date(),
		updatedByUserId: userId,
	};
}

/**
 * Records the images a template shows, replacing what was recorded before.
 *
 * @param tx The transaction.
 * @param templateId The template.
 * @param body Its body.
 */
async function linkMedia(tx: Db, templateId: string, body: TemplateBody): Promise<void> {
	await tx.delete(templateMedia).where(eq(templateMedia.templateId, templateId));
	const ids = mediaIdsOf(body);
	if (ids.length > 0) {
		await tx.insert(templateMedia).values(ids.map((mediaId) => ({ mediaId, templateId })));
	}
}

/**
 * Inserts a checked template with its images.
 *
 * @param tx The transaction.
 * @param context Who writes into which area.
 * @param input The template.
 * @returns The id of the new template.
 */
async function insertTemplate(
	tx: Db,
	context: WriteContext,
	input: TemplateInput,
): Promise<string> {
	const { actor, areaId } = context;
	const [row] = await tx
		.insert(templates)
		.values({ ...rowValues(input, actor.userId), areaId, createdByUserId: actor.userId })
		.returning({ id: templates.id });
	if (row === undefined) throw new Error('Inserting the template returned no row.');
	await linkMedia(tx, row.id, input.body);
	return row.id;
}

/**
 * Logs a change of a template with its id and ids only.
 *
 * @param tx The transaction.
 * @param entry The action, who did it, the template and the details.
 */
async function logTemplate(
	tx: Db,
	entry: Readonly<{
		action: AuditAction;
		actor: Principal;
		templateId: string;
		details: Readonly<Record<string, string>>;
	}>,
): Promise<void> {
	await writeAudit(tx, {
		action: entry.action,
		actorUserId: entry.actor.userId,
		details: entry.details,
		target: `template:${entry.templateId}`,
	});
}

/**
 * Loads a template without a permission check.
 *
 * @param db The database.
 * @param id The template.
 * @returns The template.
 * @throws {TemplateNotFoundError} When no template has the id.
 */
async function loadTemplate(db: Db, id: string): Promise<TemplateRecord> {
	const [row] = await db
		.select({
			areaId: templates.areaId,
			body: templates.body,
			id: templates.id,
			name: templates.name,
			preheader: templates.preheader,
			salutationForm: templates.salutationForm,
			salutationTexts: templates.salutationTexts,
			subject: templates.subject,
			updatedAt: templates.updatedAt,
			updatedByName: user.name,
			version: templates.version,
		})
		.from(templates)
		.leftJoin(user, eq(user.id, templates.updatedByUserId))
		.where(eq(templates.id, id));
	if (row === undefined) throw new TemplateNotFoundError();
	return {
		...row,
		body: templateBodySchema.parse(row.body),
		salutationTexts: salutationTextsSchema.parse(row.salutationTexts),
	};
}

/**
 * The area of a template.
 *
 * @param db The database.
 * @param id The template.
 * @returns The area id.
 * @throws {TemplateNotFoundError} When no template has the id.
 */
async function areaOfTemplate(db: Db, id: string): Promise<string> {
	const [row] = await db
		.select({ areaId: templates.areaId })
		.from(templates)
		.where(eq(templates.id, id));
	if (row === undefined) throw new TemplateNotFoundError();
	return row.areaId;
}

/**
 * Locks a template for a change and compares its version.
 *
 * @param tx The transaction.
 * @param id The template.
 * @param version The version the change was based on.
 * @throws {TemplateNotFoundError} When the template is gone.
 * @throws {TemplateChangedError} When somebody changed it since.
 */
async function lockVersion(tx: Db, id: string, version: number): Promise<void> {
	const [row] = await tx
		.select({ version: templates.version })
		.from(templates)
		.where(eq(templates.id, id))
		.for('update');
	if (row === undefined) throw new TemplateNotFoundError();
	if (row.version !== version) throw new TemplateChangedError();
}

/**
 * Lists the templates of every area the user may read, by name.
 *
 * @param db The database.
 * @param actor Who asks.
 * @returns The templates; none without `read` in any area.
 */
async function listTemplates(db: Db, actor: Principal): Promise<TemplateSummary[]> {
	const areaIds = [...actor.areas.keys()].filter((areaId) => canAccessArea(actor, areaId, 'read'));
	if (areaIds.length === 0) return [];
	return db
		.select({
			areaId: templates.areaId,
			bodyKind: sql<TemplateSummary['bodyKind']>`${templates.body}->>'kind'`,
			id: templates.id,
			name: templates.name,
			updatedAt: templates.updatedAt,
			version: templates.version,
		})
		.from(templates)
		.where(inArray(templates.areaId, areaIds))
		.orderBy(sql`lower(${templates.name})`, templates.name, templates.id);
}

/**
 * Loads a template for its editor or preview.
 *
 * @param db The database.
 * @param actor Who asks; needs `read` in the template's area.
 * @param id The template.
 * @returns The template.
 * @throws {TemplateNotFoundError} When no template has the id.
 * @throws {ForbiddenError} Without `read` in the area.
 */
async function getTemplate(db: Db, actor: Principal, id: string): Promise<TemplateRecord> {
	const record = await loadTemplate(db, id);
	assertArea(actor, record.areaId, 'read');
	return record;
}

/**
 * Creates a template in an area, after the same checks as a save.
 *
 * @param db The database.
 * @param actor Who creates it; needs `edit` in the area.
 * @param areaId The area.
 * @param input The template.
 * @returns The id of the new template.
 * @throws {ForbiddenError} Without `edit` in the area.
 * @throws {z.ZodError} When the input does not pass `templateInputSchema` (callers validate first).
 * @throws {UnknownAreaError} When the area does not exist (any more).
 * @throws {LayoutNotFoundError} When the chosen global layout does not exist.
 * @throws {TemplateInvalidError} When the template does not pass the save checks.
 * @throws {TemplateNameTakenError} When another template of the area has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function createTemplate(
	db: Db,
	actor: Principal,
	areaId: string,
	input: TemplateInput,
): Promise<{ id: string }> {
	assertArea(actor, areaId, 'edit');
	const parsed = templateInputSchema.parse(input);
	const context: WriteContext = {
		actor,
		allowed: await allowedTemplatePlaceholders(db, areaId),
		areaId,
	};
	return withUniqueName(async () =>
		db.transaction(async (tx) => {
			await lockArea(tx, areaId);
			const checked = await assertSavable(tx, context, parsed);
			const id = await insertTemplate(tx, context, checked);
			await logTemplate(tx, {
				action: 'template.created',
				actor,
				details: { areaId },
				templateId: id,
			});
			return { id };
		}),
	);
}

/**
 * Creates a template from a starter, with the name and subject of the creation dialog.
 *
 * @param db The database.
 * @param actor Who creates it; needs `edit` in the area.
 * @param areaId The area.
 * @param starter The starter.
 * @param names The name and the subject.
 * @returns The id of the new template.
 * @throws {ForbiddenError} Without `edit` in the area.
 * @throws {UnknownAreaError} When the area does not exist (any more).
 * @throws {TemplateInvalidError} When name or subject do not pass the save checks.
 * @throws {TemplateNameTakenError} When another template of the area has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function createFromStarter(
	db: Db,
	actor: Principal,
	areaId: string,
	starter: StarterId,
	names: Readonly<{ name: string; subject: string }>,
): Promise<{ id: string }> {
	const { body, preheader, salutationForm, salutationTexts } = starterTemplate(starter);
	return createTemplate(db, actor, areaId, {
		body,
		name: names.name,
		preheader,
		salutationForm,
		salutationTexts,
		subject: names.subject,
	});
}

/**
 * Saves a template. In one transaction the row is locked (`FOR UPDATE`) and its version compared,
 * so of two saves based on the same version the second is refused and nothing is lost.
 *
 * @param db The database.
 * @param actor Who saves; needs `edit` in the template's area.
 * @param id The template.
 * @param input The template as edited.
 * @param version The version the editor loaded.
 * @returns The new version.
 * @throws {TemplateNotFoundError} When no template has the id.
 * @throws {ForbiddenError} Without `edit` in the area.
 * @throws {z.ZodError} When the input does not pass `templateInputSchema` (callers validate first).
 * @throws {TemplateChangedError} When somebody saved since the editor loaded the template.
 * @throws {LayoutNotFoundError} When the chosen global layout does not exist.
 * @throws {TemplateInvalidError} When the template does not pass the save checks.
 * @throws {TemplateNameTakenError} When another template of the area has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function saveTemplate(
	db: Db,
	actor: Principal,
	id: string,
	input: TemplateInput,
	version: number,
): Promise<{ version: number }> {
	const areaId = await areaOfTemplate(db, id);
	assertArea(actor, areaId, 'edit');
	const parsed = templateInputSchema.parse(input);
	const context: WriteContext = {
		actor,
		allowed: await allowedTemplatePlaceholders(db, areaId),
		areaId,
	};
	return withUniqueName(async () =>
		db.transaction(async (tx) => {
			await lockVersion(tx, id, version);
			const checked = await assertSavable(tx, context, parsed);
			const next = version + 1;
			await tx
				.update(templates)
				.set({ ...rowValues(checked, actor.userId), version: next })
				.where(eq(templates.id, id));
			await linkMedia(tx, id, checked.body);
			await logTemplate(tx, {
				action: 'template.updated',
				actor,
				details: { areaId },
				templateId: id,
			});
			return { version: next };
		}),
	);
}

/**
 * A template with each copied image replaced by its copy.
 *
 * @param input The template.
 * @param copies The copy of each image.
 * @returns The template with new blocks, or as it is without copies.
 */
function withCopiedImages(input: TemplateInput, copies: ImageCopies): TemplateInput {
	const { body } = input;
	if (copies.size === 0) return input;
	if (body.kind === 'html') {
		return { ...input, body: { ...body, html: swapHtmlMediaIds(body.html, copies) } };
	}
	const swap = (block: ColumnBlock): ColumnBlock =>
		block.type === 'image' && block.mediaId !== null
			? { ...block, mediaId: copies.get(block.mediaId) ?? block.mediaId }
			: block;
	const blocks = body.blocks.map((block): Block =>
		block.type === 'columns'
			? { ...block, left: block.left.map(swap), right: block.right.map(swap) }
			: swap(block),
	);
	const layout: TemplateLayout =
		body.layout.kind === 'own'
			? { ...body.layout, html: swapHtmlMediaIds(body.layout.html, copies) }
			: body.layout;
	return { ...input, body: { ...body, blocks, layout } };
}

/**
 * Copies one stored image under a new id.
 *
 * @param storage The object storage.
 * @param id The image.
 * @returns The id of the copy.
 */
async function copyObject(storage: ObjectStorage, id: string): Promise<string> {
	const object = await storage.get(mediaStorageKey(id));
	if (object === null) throw new Error('A stored image is missing.');
	const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
	const copyId = newMediaId();
	await storage.put(mediaStorageKey(copyId), bytes, { contentType: object.contentType });
	return copyId;
}

/**
 * Deletes copied images again.
 *
 * @param storage The object storage; null when nothing was copied.
 * @param copies The copies.
 */
async function deleteCopies(storage: ObjectStorage | null, copies: ImageCopies): Promise<void> {
	if (storage === null) return;
	await Promise.all(
		[...copies.values()].map(async (copyId) => storage.delete(mediaStorageKey(copyId))),
	);
}

/**
 * Copies stored images under new ids; when one fails, the copies made so far are deleted.
 *
 * @param storage The object storage.
 * @param ids The images.
 * @returns The copy of each image.
 * @throws {StorageNotConfiguredError} When there are images and no storage.
 */
async function copyObjects(
	storage: ObjectStorage | null,
	ids: readonly string[],
): Promise<ImageCopies> {
	const copies = new Map<string, string>();
	if (ids.length === 0) return copies;
	if (storage === null) throw new StorageNotConfiguredError();
	try {
		for (const id of ids) {
			// oxlint-disable-next-line no-await-in-loop -- one image at a time holds at most one (2 MB) in memory
			copies.set(id, await copyObject(storage, id));
		}
	} catch (error) {
		await deleteCopies(storage, copies);
		throw error;
	}
	return copies;
}

/**
 * Adds the rows of copied images to the target area's library: same name, type and size, a new
 * id, uploaded by the one who duplicates.
 *
 * @param tx The transaction.
 * @param context Who writes into which area.
 * @param copies The copy of each image.
 * @throws {TemplateNotFoundError} When a source image is gone, so the source template went too.
 */
async function insertImageCopies(
	tx: Db,
	context: WriteContext,
	copies: ImageCopies,
): Promise<void> {
	if (copies.size === 0) return;
	const rows = await tx
		.select()
		.from(media)
		.where(inArray(media.id, [...copies.keys()]))
		.for('key share');
	const byId = new Map(rows.map((row) => [row.id, row]));
	const values = [...copies].map(([sourceId, copyId]) => {
		const source = byId.get(sourceId);
		if (source === undefined) throw new TemplateNotFoundError();
		const { bytes, height, name, type, width } = source;
		return {
			areaId: context.areaId,
			bytes,
			createdByUserId: context.actor.userId,
			height,
			id: copyId,
			name,
			purpose: 'library' as const,
			type,
			width,
		};
	});
	await tx.insert(media).values(values);
}

/**
 * The copy of a template under a new name, checked against the target area. Its images count as
 * the target's, since they come along; the transaction checks again with the real rows.
 *
 * @param source The template.
 * @param name The name of the copy.
 * @param allowed The placeholders of the target area.
 * @returns The copy.
 * @throws {TemplateInvalidError} When the copy does not pass the save checks.
 */
function checkedCopy(
	source: TemplateRecord,
	name: string,
	allowed: AllowedPlaceholders,
): TemplateInput {
	const { body, preheader, salutationForm, salutationTexts, subject } = source;
	const input: TemplateInput = { body, name, preheader, salutationForm, salutationTexts, subject };
	const problems = checkTemplateForSave(input, allowed, new Set(mediaIdsOf(body)));
	if (problems.length > 0) throw new TemplateInvalidError(problems);
	return input;
}

/**
 * Stores the copy of a template in the target area, with the rows of its copied images.
 *
 * @param tx The transaction.
 * @param context Who writes into which area.
 * @param copy The copy, its source and the copied images.
 * @param copy.input The copy as the source shows it.
 * @param copy.sourceId The source template.
 * @param copy.copies The copy of each image of another area.
 * @returns The id of the copy.
 */
async function insertCopy(
	tx: Db,
	context: WriteContext,
	copy: Readonly<{ input: TemplateInput; sourceId: string; copies: ImageCopies }>,
): Promise<{ id: string }> {
	await lockArea(tx, context.areaId);
	await insertImageCopies(tx, context, copy.copies);
	const input = withCopiedImages(copy.input, copy.copies);
	const checked = await assertSavable(tx, context, input);
	const id = await insertTemplate(tx, context, checked);
	await logTemplate(tx, {
		action: 'template.duplicated',
		actor: context.actor,
		details: { areaId: context.areaId, sourceTemplateId: copy.sourceId },
		templateId: id,
	});
	return { id };
}

/**
 * Duplicates a template into an area under a new name. Within the area the copy shows the same
 * images; into another area each image is copied (new id, new stored object, new row in the
 * target library) and the copy shows the copies. Placeholders the target area does not allow
 * refuse the copy before anything is copied; when storing the copy fails, the copied objects are
 * deleted again.
 *
 * @param db The database.
 * @param storage The object storage, null when none is set up.
 * @param actor Who duplicates; needs `read` in the source and `edit` in the target area.
 * @param id The template.
 * @param targetAreaId The area of the copy.
 * @param name The name of the copy.
 * @returns The id of the copy.
 * @throws {TemplateNotFoundError} When no template has the id.
 * @throws {ForbiddenError} Without `read` in the source or `edit` in the target area.
 * @throws {TemplateInvalidError} When the copy does not pass the save checks in the target area.
 * @throws {StorageNotConfiguredError} When images must be copied and no storage is set up.
 * @throws {UnknownAreaError} When the target area does not exist (any more).
 * @throws {TemplateNameTakenError} When another template of the target area has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function duplicateTemplate(
	db: Db,
	storage: ObjectStorage | null,
	actor: Principal,
	id: string,
	targetAreaId: string,
	name: string,
): Promise<{ id: string }> {
	const source = await loadTemplate(db, id);
	assertArea(actor, source.areaId, 'read');
	assertArea(actor, targetAreaId, 'edit');
	const context: WriteContext = {
		actor,
		allowed: await allowedTemplatePlaceholders(db, targetAreaId),
		areaId: targetAreaId,
	};
	const input = checkedCopy(source, name, context.allowed);
	// Within the area the copy shares the images; into another one they are copied.
	const copies = await copyObjects(
		storage,
		targetAreaId === source.areaId ? [] : mediaIdsOf(input.body),
	);
	try {
		return await withUniqueName(async () =>
			db.transaction(async (tx) => insertCopy(tx, context, { copies, input, sourceId: id })),
		);
	} catch (error) {
		await deleteCopies(storage, copies);
		throw error;
	}
}

/**
 * Deletes a template; its image records go with it.
 *
 * @param db The database.
 * @param actor Who deletes it; needs `edit` in the template's area.
 * @param id The template.
 * @param version The version the page loaded.
 * @throws {TemplateNotFoundError} When no template has the id.
 * @throws {ForbiddenError} Without `edit` in the area.
 * @throws {TemplateChangedError} When somebody saved since the page loaded the template.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function deleteTemplate(
	db: Db,
	actor: Principal,
	id: string,
	version: number,
): Promise<void> {
	const areaId = await areaOfTemplate(db, id);
	assertArea(actor, areaId, 'edit');
	await db.transaction(async (tx) => {
		await lockVersion(tx, id, version);
		await tx.delete(templates).where(eq(templates.id, id));
		await logTemplate(tx, {
			action: 'template.deleted',
			actor,
			details: { areaId },
			templateId: id,
		});
	});
}

/**
 * The global layouts a template can choose, by name, with their HTML for the editor's preview.
 *
 * @param db The database.
 * @returns Id, name and HTML of each layout.
 */
async function listLayoutChoices(db: Db): Promise<{ id: string; name: string; html: string }[]> {
	return db
		.select({ html: layouts.html, id: layouts.id, name: layouts.name })
		.from(layouts)
		.orderBy(sql`lower(${layouts.name})`, layouts.name, layouts.id);
}

export {
	createFromStarter,
	createTemplate,
	deleteTemplate,
	duplicateTemplate,
	getTemplate,
	listLayoutChoices,
	listTemplates,
	saveTemplate,
};
export type { TemplateBody, TemplateInput, TemplateLayout } from '@/mail/templates/template-schema';
export type { TemplateRecord, TemplateSummary };
