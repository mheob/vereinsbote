/*
 * Replaces the HTML of an HTML template with a newly imported one (Design 22). The rest of the
 * template stays as it is; the save runs the same checks and the same version comparison as the
 * editor's save, so the HTML is cleaned and its images and placeholders are judged again.
 */
import type { Db } from '@/server/db/client';
import type { Principal } from '@/server/permissions/principal';

import { TemplateNotHtmlError } from './errors';
import { getTemplate, saveTemplate } from './templates';

/**
 * Saves new HTML into an HTML template.
 *
 * @param db The database.
 * @param actor Who saves; needs `edit` in the template's area.
 * @param id The template.
 * @param html The new HTML.
 * @param version The version the page loaded.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @returns The new version.
 * @throws {TemplateNotFoundError} When no template has the id.
 * @throws {ForbiddenError} Without `edit` in the area.
 * @throws {TemplateNotHtmlError} When the template is made of blocks.
 * @throws {TemplateChangedError} When somebody saved since the page loaded the template.
 * @throws {TemplateInvalidError} When the HTML does not pass the save checks.
 */
// oxlint-disable-next-line max-params -- the database, the user, the template, the HTML, its version and the origin
async function replaceTemplateHtml(
	db: Db,
	actor: Principal,
	id: string,
	html: string,
	version: number,
	appOrigin: string,
): Promise<{ version: number }> {
	const { body, name, preheader, salutationForm, salutationTexts, subject } = await getTemplate(
		db,
		actor,
		id,
	);
	if (body.kind !== 'html') throw new TemplateNotHtmlError();
	return saveTemplate(
		db,
		actor,
		id,
		{ body: { html, kind: 'html' }, name, preheader, salutationForm, salutationTexts, subject },
		version,
		appOrigin,
	);
}

export { replaceTemplateHtml };
