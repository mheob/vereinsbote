/*
 * The global layouts (Design 4, 22): HTML frames around the blocks of a template, imported by an
 * admin and chosen by the editors of every area. Every change is the admin's; the admin role is
 * all it takes, since a layout belongs to no area. A layout takes brand values, the base fields of
 * contacts and `{{content}}`, nothing a protected field would deliver. Replacing runs under a row
 * lock and a version, and a layout in use cannot be deleted. The activity log names ids only.
 */
import { and, count, eq, sql } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { listCustomFields } from '@/server/contacts/settings';
import type { Db } from '@/server/db/client';
import { isForeignKeyViolationOf, isUniqueViolation } from '@/server/db/errors';
import { layouts, media, templates } from '@/server/db/schema';
import { importHtml } from '@/server/html-import/import-html';
import type { ImportKind, ImportRefusal } from '@/server/html-import/import-html';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { allowedLayoutPlaceholders } from '@/server/templates/allowed-placeholders';
import {
	LayoutChangedError,
	LayoutInUseError,
	LayoutNameInvalidError,
	LayoutNameTakenError,
	LayoutNotFoundError,
} from '@/server/templates/errors';

import { MAX_LAYOUT_NAME_LENGTH } from './limits';

/** The name of the foreign key that keeps a layout in use from being deleted. */
const SHARED_LAYOUT_FK = 'templates_shared_layout_id_layouts_id_fk';

/** A layout in the list. */
interface LayoutSummary {
	readonly id: string;
	readonly name: string;
	/** How many templates use it. */
	readonly usedBy: number;
	readonly updatedAt: Date;
}

/** A layout as its page loads it. */
interface LayoutRecord extends LayoutSummary {
	readonly html: string;
	/** Sent back when the HTML is replaced; a newer one refuses it. */
	readonly version: number;
}

/** What an import of a layout gave: the stored layout, or why it was refused. */
interface Refused {
	readonly refusals: ImportRefusal[];
}

/**
 * The number of templates that use layouts, by layout.
 *
 * @param db The database.
 * @param layoutId Only this layout, or all.
 * @returns The count per layout id.
 */
async function usageCounts(db: Db, layoutId?: string): Promise<Map<string, number>> {
	const rows = await db
		.select({ id: templates.sharedLayoutId, templates: count() })
		.from(templates)
		.where(
			layoutId === undefined
				? sql`${templates.sharedLayoutId} is not null`
				: eq(templates.sharedLayoutId, layoutId),
		)
		.groupBy(templates.sharedLayoutId);
	return new Map(rows.flatMap(({ id, templates: used }) => (id === null ? [] : [[id, used]])));
}

/**
 * Lists the global layouts by name.
 *
 * @param db The database.
 * @param actor Who asks; an admin.
 * @returns The layouts with the number of templates that use each.
 * @throws {ForbiddenError} For anybody but an admin.
 */
async function listLayouts(db: Db, actor: Principal): Promise<LayoutSummary[]> {
	assertAdmin(actor);
	const [rows, used] = await Promise.all([
		db
			.select({ id: layouts.id, name: layouts.name, updatedAt: layouts.updatedAt })
			.from(layouts)
			.orderBy(sql`lower(${layouts.name})`, layouts.name, layouts.id),
		usageCounts(db),
	]);
	return rows.map(({ id, name, updatedAt }) => ({
		id,
		name,
		updatedAt,
		usedBy: used.get(id) ?? 0,
	}));
}

/**
 * Loads a layout with its HTML.
 *
 * @param db The database.
 * @param actor Who asks; an admin.
 * @param id The layout.
 * @returns The layout.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {LayoutNotFoundError} When no layout has the id.
 */
async function getLayout(db: Db, actor: Principal, id: string): Promise<LayoutRecord> {
	assertAdmin(actor);
	const [[row], used] = await Promise.all([
		db
			.select({
				html: layouts.html,
				id: layouts.id,
				name: layouts.name,
				updatedAt: layouts.updatedAt,
				version: layouts.version,
			})
			.from(layouts)
			.where(eq(layouts.id, id)),
		usageCounts(db, id),
	]);
	if (row === undefined) throw new LayoutNotFoundError();
	return { ...row, usedBy: used.get(id) ?? 0 };
}

/**
 * What a global layout may use: brand values, the base fields of contacts and `{{content}}`, and
 * the brand's images. Runs several queries at once: call it before a transaction, never inside
 * one.
 *
 * @param db The database.
 * @returns The kind of import for `importHtml`.
 */
async function globalLayoutKind(db: Db): Promise<Extract<ImportKind, { kind: 'globalLayout' }>> {
	const [members, partners, brandImages] = await Promise.all([
		listCustomFields(db, 'member'),
		listCustomFields(db, 'partner'),
		db.select({ id: media.id }).from(media).where(eq(media.purpose, 'brand')),
	]);
	return {
		allowed: allowedLayoutPlaceholders('global', [...members, ...partners]),
		brandMediaIds: new Set(brandImages.map(({ id }) => id)),
		kind: 'globalLayout',
	};
}

/**
 * Imports the HTML of a layout.
 *
 * @param db The database.
 * @param source The HTML as the admin brought it.
 * @param appOrigin The origin of the app (`APP_URL`), to recognize its images.
 * @returns The cleaned HTML, or the refusals.
 */
async function importLayout(
	db: Db,
	source: string,
	appOrigin: string,
): Promise<{ html: string } | Refused> {
	const result = importHtml(source, await globalLayoutKind(db), appOrigin);
	return result.ok ? { html: result.html } : { refusals: [...result.refusals] };
}

/**
 * Logs a change of a layout with its id only.
 *
 * @param tx The transaction.
 * @param action What happened.
 * @param actor Who did it.
 * @param layoutId The layout.
 */
// oxlint-disable-next-line max-params -- the transaction, the action, the actor and the layout
async function logLayout(
	tx: Db,
	action: AuditAction,
	actor: Principal,
	layoutId: string,
): Promise<void> {
	await writeAudit(tx, { action, actorUserId: actor.userId, target: `layout:${layoutId}` });
}

/**
 * The name of a layout, trimmed.
 *
 * @param name What the admin typed.
 * @returns The name.
 * @throws {LayoutNameInvalidError} When it is empty or longer than 100 characters.
 */
function checkedName(name: string): string {
	const trimmed = name.trim();
	if (trimmed === '' || trimmed.length > MAX_LAYOUT_NAME_LENGTH) throw new LayoutNameInvalidError();
	return trimmed;
}

/**
 * Creates a global layout from imported HTML.
 *
 * @param db The database.
 * @param actor Who creates it; an admin.
 * @param input The name and the HTML as brought.
 * @param input.name The name.
 * @param input.source The HTML.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @returns The id of the layout, or the refusals of the import (nothing is stored then).
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {LayoutNameInvalidError} When the name is empty or too long.
 * @throws {LayoutNameTakenError} When another layout has the name.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function createLayout(
	db: Db,
	actor: Principal,
	input: Readonly<{ name: string; source: string }>,
	appOrigin: string,
): Promise<{ id: string } | Refused> {
	assertAdmin(actor);
	const name = checkedName(input.name);
	const imported = await importLayout(db, input.source, appOrigin);
	if ('refusals' in imported) return imported;
	try {
		return await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(layouts)
				.values({
					createdByUserId: actor.userId,
					html: imported.html,
					name,
					updatedByUserId: actor.userId,
				})
				.returning({ id: layouts.id });
			if (row === undefined) throw new Error('Inserting the layout returned no row.');
			await logLayout(tx, 'layout.created', actor, row.id);
			return { id: row.id };
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new LayoutNameTakenError();
		throw error;
	}
}

/**
 * Replaces the HTML of a layout. The row is locked and its version compared, so of two
 * replacements based on the same version the second is refused.
 *
 * @param db The database.
 * @param actor Who replaces it; an admin.
 * @param id The layout.
 * @param source The new HTML as brought.
 * @param version The version the page loaded.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @returns The new version, or the refusals of the import (nothing changes then).
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {LayoutNotFoundError} When no layout has the id.
 * @throws {LayoutChangedError} When somebody replaced it since the page loaded it.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function replaceLayout(
	db: Db,
	actor: Principal,
	id: string,
	source: string,
	version: number,
	appOrigin: string,
): Promise<{ version: number } | Refused> {
	assertAdmin(actor);
	const imported = await importLayout(db, source, appOrigin);
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ version: layouts.version })
			.from(layouts)
			.where(eq(layouts.id, id))
			.for('update');
		if (row === undefined) throw new LayoutNotFoundError();
		if (row.version !== version) throw new LayoutChangedError();
		if ('refusals' in imported) return imported;
		const next = version + 1;
		await tx
			.update(layouts)
			.set({
				html: imported.html,
				updatedAt: new Date(),
				updatedByUserId: actor.userId,
				version: next,
			})
			.where(and(eq(layouts.id, id), eq(layouts.version, version)));
		await logLayout(tx, 'layout.updated', actor, id);
		return { version: next };
	});
}

/**
 * Deletes a layout no template uses. The count is checked first; the restricting foreign key
 * answers for a template that chose the layout in the meantime.
 *
 * @param db The database.
 * @param actor Who deletes it; an admin.
 * @param id The layout.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {LayoutNotFoundError} When no layout has the id.
 * @throws {LayoutInUseError} When templates use it; the error says how many.
 */
async function deleteLayout(db: Db, actor: Principal, id: string): Promise<void> {
	assertAdmin(actor);
	const counts = await usageCounts(db, id);
	const used = counts.get(id) ?? 0;
	if (used > 0) throw new LayoutInUseError(used);
	try {
		await db.transaction(async (tx) => {
			const deleted = await tx
				.delete(layouts)
				.where(eq(layouts.id, id))
				.returning({ id: layouts.id });
			if (deleted.length === 0) throw new LayoutNotFoundError();
			await logLayout(tx, 'layout.deleted', actor, id);
		});
	} catch (error) {
		if (!isForeignKeyViolationOf(error, SHARED_LAYOUT_FK)) throw error;
		const raced = await usageCounts(db, id);
		throw new LayoutInUseError(raced.get(id) ?? 1);
	}
}

export { createLayout, deleteLayout, getLayout, globalLayoutKind, listLayouts, replaceLayout };
export type { LayoutRecord, LayoutSummary };
