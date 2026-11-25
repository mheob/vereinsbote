/*
 * Checks HTML a user wants to import, without storing anything (Design 22): the cleaning and the
 * refusals of the import for a template, the own layout of a template or a global layout, with
 * what that target may use. The rights are those of the target: `edit` in the area for a template
 * and its own layout, the admin role for a global layout. The save repeats the checks.
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { media } from '@/server/db/schema';
import { importedMediaIds, importHtml } from '@/server/html-import/import-html';
import type { ImportKind, ImportResult } from '@/server/html-import/import-html';
import { globalLayoutKind } from '@/server/layouts/layouts';
import { assertAdmin, assertArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { allowedLayoutPlaceholders, allowedTemplatePlaceholders } from './allowed-placeholders';
import { areaOfTemplate } from './templates';

/** What is checked, and where it would go. */
type ImportCheckRequest =
	| Readonly<{ target: 'globalLayout'; html: string }>
	| Readonly<{
			target: 'template' | 'ownLayout';
			html: string;
			/** The area of a template that is created; one of the two is given. */
			areaId?: string;
			/** The template whose HTML or own layout is replaced; its area counts. */
			templateId?: string;
	  }>;

/**
 * The library images of an area among the ones an HTML shows.
 *
 * @param db The database.
 * @param areaId The area.
 * @param ids The images an HTML shows.
 * @returns The ids that are library images of the area.
 */
async function areaImageIds(db: Db, areaId: string, ids: readonly string[]): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const rows = await db
		.select({ id: media.id })
		.from(media)
		.where(
			and(inArray(media.id, [...ids]), eq(media.areaId, areaId), eq(media.purpose, 'library')),
		);
	return new Set(rows.map(({ id }) => id));
}

/**
 * The area a request is checked in.
 *
 * @param db The database.
 * @param request A template or an own layout.
 * @returns The area id.
 * @throws {TemplateNotFoundError} When the template does not exist.
 * @throws {TypeError} When the request names neither a template nor an area.
 */
async function areaOfRequest(
	db: Db,
	request: Extract<ImportCheckRequest, { target: 'template' | 'ownLayout' }>,
): Promise<string> {
	if (request.templateId !== undefined) return areaOfTemplate(db, request.templateId);
	if (request.areaId === undefined) throw new TypeError('An import names a template or an area.');
	return request.areaId;
}

/**
 * Cleans and checks HTML for an import; nothing is stored. Several queries run at once: call it
 * outside a transaction.
 *
 * @param db The database.
 * @param actor Who imports.
 * @param request The HTML and its target.
 * @param appOrigin The origin of the app (`APP_URL`), to recognize its images.
 * @returns The cleaned HTML with the findings, or the refusals.
 * @throws {ForbiddenError} Without `edit` in the area (template, own layout) or the admin role.
 * @throws {TemplateNotFoundError} When the template does not exist.
 */
// oxlint-disable-next-line max-params -- the database, the user, the request and the origin of the app
async function checkHtmlImport(
	db: Db,
	actor: Principal,
	request: ImportCheckRequest,
	appOrigin: string,
): Promise<ImportResult> {
	if (request.target === 'globalLayout') {
		assertAdmin(actor);
		return importHtml(request.html, await globalLayoutKind(db), appOrigin);
	}
	const areaId = await areaOfRequest(db, request);
	assertArea(actor, areaId, 'edit');
	const [allowed, areaMediaIds] = await Promise.all([
		allowedTemplatePlaceholders(db, areaId),
		areaImageIds(db, areaId, importedMediaIds(request.html, appOrigin)),
	]);
	const kind: ImportKind =
		request.target === 'template'
			? { allowed, areaMediaIds, kind: 'template' }
			: {
					allowed: allowedLayoutPlaceholders('template', allowed),
					areaMediaIds,
					kind: 'ownLayout',
				};
	return importHtml(request.html, kind, appOrigin);
}

export { checkHtmlImport };
export type { ImportCheckRequest };
