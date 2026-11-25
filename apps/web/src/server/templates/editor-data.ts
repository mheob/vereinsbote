/*
 * What the editor of a template loads (Design 13): the template, whether the user may change it,
 * the brand and the global layouts for the preview, the images it shows, the placeholders it may
 * offer, and the save checks' problems as of now. A template passed them when it was saved, but a
 * later change elsewhere (field protection) can break it; the editor shows that at once (Design 9).
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { Brand } from '@/mail/brand/brand-schema';
import type { MediaInfo } from '@/mail/render/compile';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { getBrand } from '@/server/brand/brand';
import { listCustomFields } from '@/server/contacts/settings';
import type { Db } from '@/server/db/client';
import { areas, media } from '@/server/db/schema';
import { canAccessArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { allowedTemplatePlaceholders } from './allowed-placeholders';
import { editorPlaceholders } from './editor-placeholders';
import type { EditorPlaceholder } from './editor-placeholders';
import { checkTemplateForSave } from './save-checks';
import type { SaveProblem } from './save-checks';
import { getTemplate, listLayoutChoices, mediaIdsOf } from './templates';
import type { TemplateRecord } from './templates';

/** An image the template shows: what the preview needs, and its name for the form. */
interface EditorMedia extends MediaInfo {
	readonly name: string;
}

/** A global layout with its HTML, which the preview puts the blocks into. */
interface LayoutSource {
	readonly id: string;
	readonly name: string;
	readonly html: string;
}

interface TemplateEditorData {
	readonly template: TemplateRecord;
	readonly areaName: string;
	/** Whether the user has `edit` in the area; else the editor is read-only. */
	readonly canEdit: boolean;
	readonly brand: Brand;
	readonly placeholders: readonly EditorPlaceholder[];
	readonly layouts: readonly LayoutSource[];
	/** The library images of the area that the template shows, by id. */
	readonly media: Readonly<Record<string, EditorMedia>>;
	/** What the save checks find now, for an HTML template too (the import checks its HTML again). */
	readonly problems: readonly SaveProblem[];
}

/**
 * The library images of an area among the ones a template shows.
 *
 * @param db The database.
 * @param areaId The area.
 * @param ids The images of the template.
 * @returns The images by id.
 */
async function areaImages(
	db: Db,
	areaId: string,
	ids: readonly string[],
): Promise<Record<string, EditorMedia>> {
	if (ids.length === 0) return {};
	const rows = await db
		.select({
			height: media.height,
			id: media.id,
			name: media.name,
			type: media.type,
			width: media.width,
		})
		.from(media)
		.where(
			and(inArray(media.id, [...ids]), eq(media.areaId, areaId), eq(media.purpose, 'library')),
		);
	return Object.fromEntries(
		rows.map(({ height, id, name, type, width }) => [id, { height, name, type, width }]),
	);
}

/**
 * The name of an area.
 *
 * @param db The database.
 * @param areaId The area.
 * @returns The name; empty when the area is gone.
 */
async function areaName(db: Db, areaId: string): Promise<string> {
	const [row] = await db.select({ name: areas.name }).from(areas).where(eq(areas.id, areaId));
	return row?.name ?? '';
}

/**
 * The input part of a template, as the save checks measure it.
 *
 * @param record The template.
 * @returns Name, subject, preview text, salutation and body.
 */
function inputOf(record: TemplateRecord): TemplateInput {
	const { body, name, preheader, salutationForm, salutationTexts, subject } = record;
	return { body, name, preheader, salutationForm, salutationTexts, subject };
}

/**
 * Loads a template for its editor. Runs several queries at once: never inside a transaction.
 *
 * @param db The database.
 * @param actor Who opens it; needs `read` in the template's area.
 * @param id The template.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @returns What the editor shows.
 * @throws {TemplateNotFoundError} When no template has the id.
 * @throws {ForbiddenError} Without `read` in the area.
 */
// oxlint-disable-next-line max-params -- the database, the user, the template and the origin of the app
async function loadTemplateEditorData(
	db: Db,
	actor: Principal,
	id: string,
	appOrigin: string,
): Promise<TemplateEditorData> {
	const template = await getTemplate(db, actor, id);
	const { areaId, body } = template;
	const mediaIds = mediaIdsOf(body, appOrigin);
	const [name, allowed, members, partners, layouts, brand, images] = await Promise.all([
		areaName(db, areaId),
		allowedTemplatePlaceholders(db, areaId),
		listCustomFields(db, 'member'),
		listCustomFields(db, 'partner'),
		listLayoutChoices(db),
		getBrand(db),
		areaImages(db, areaId, mediaIds),
	]);
	const problems = checkTemplateForSave(
		inputOf(template),
		allowed,
		new Set(Object.keys(images)),
		appOrigin,
	);
	return {
		areaName: name,
		brand: brand.brand,
		canEdit: canAccessArea(actor, areaId, 'edit'),
		layouts,
		media: images,
		placeholders: editorPlaceholders(allowed.keys, [...members, ...partners]),
		problems,
		template,
	};
}

export { loadTemplateEditorData };
export type { EditorMedia, LayoutSource, TemplateEditorData };
