import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { fromForm } from '@/functions/from-form';
import type { Brand } from '@/mail/brand/brand-schema';
import { STARTER_IDS } from '@/mail/starters/starters';
import {
	MAX_REQUEST_HTML,
	salutationWithinBounds,
	templateWithinBounds,
} from '@/mail/templates/request-bounds';
import { salutationTextsSchema, templateInputSchema } from '@/mail/templates/template-schema';
import { MAX_SEARCH_LENGTH } from '@/server/contacts/list-query';
import type { ImportFinding, ImportRefusal } from '@/server/html-import/import-html';
import type { TemplateEditorData } from '@/server/templates/editor-data';
import type { CreateHtmlFailure, SaveFailure } from '@/server/templates/failures';
import type { PreviewContact } from '@/server/templates/preview-values';
import type { TemplateSummary } from '@/server/templates/templates';

/*
 * The server functions of the template pages. Server modules are imported inside the handlers, so
 * they stay out of the client bundle. Each handler authorizes itself from the session principal:
 * server functions are reachable without their page. Expected refusals come back as results.
 */

/** An area whose templates the user may see. */
interface TemplateArea {
	readonly id: string;
	readonly name: string;
	readonly canEdit: boolean;
}

interface TemplateListPage {
	readonly templates: readonly Readonly<TemplateSummary>[];
	/** The areas the user may read, by name; `canEdit` says whether templates can be changed there. */
	readonly areas: readonly Readonly<TemplateArea>[];
}

/** A template in its editor, with what the editor needs. */
interface TemplateEditorPage extends TemplateEditorData {
	/** The origin of the app, for the preview's image addresses. */
	readonly appOrigin: string;
}

/** What the page "Neue Vorlage" needs: the areas the user may read and what a preview needs. */
interface NewTemplatePage {
	readonly areas: TemplateListPage['areas'];
	readonly brand: Brand;
	/** The origin of the app, for the preview's image addresses. */
	readonly appOrigin: string;
}

/**
 * What checking HTML for an import gave: the cleaned HTML with what was removed and warned about,
 * or the refusals, or that the template of the import is gone.
 */
type CheckHtmlImportResult = Readonly<
	| { ok: true; html: string; findings: readonly ImportFinding[] }
	| { ok: false; refusals: readonly ImportRefusal[] }
	| { ok: false; failure: 'gone' }
>;

type CreateHtmlTemplateResult = Readonly<{ ok: true; id: string }> | CreateHtmlFailure;

type CreateTemplateResult = Readonly<
	{ ok: true; id: string } | { ok: false; failure: 'nameTaken' | 'invalid' | 'gone' }
>;

type DuplicateResult = Readonly<
	| { ok: true; id: string }
	| { ok: false; failure: 'nameTaken' | 'storageMissing' | 'gone' }
	| { ok: false; failure: 'forbiddenPlaceholders'; keys: readonly string[] }
>;

type DeleteTemplateResult = Readonly<{ ok: true } | { ok: false; failure: 'changed' | 'gone' }>;

type SaveTemplateResult = Readonly<{ ok: true; version: number }> | SaveFailure;

type PreviewValuesResult = Readonly<
	{ ok: true; values: Readonly<Record<string, string>> } | { ok: false; failure: 'gone' }
>;

/** The longest id the server looks at; ids are 36 characters. */
const MAX_ID_LENGTH = 100;
/** The longest name or subject accepted before the save checks' own limits (100 and 200). */
const MAX_TEXT_INPUT = 10_000;

const createRequest = z.object({
	areaId: z.uuid(),
	name: z.string().max(MAX_TEXT_INPUT),
	start: z.enum(['empty', ...STARTER_IDS]),
	subject: z.string().max(MAX_TEXT_INPUT),
});
const duplicateRequest = z.object({
	id: z.uuid(),
	name: z.string().max(MAX_TEXT_INPUT),
	targetAreaId: z.uuid(),
});
const deleteRequest = z.object({ id: z.uuid(), version: z.int().min(1) });
const pageRequest = z.object({ id: z.string().max(MAX_ID_LENGTH) });
const searchRequest = z.object({
	query: z.string().max(MAX_SEARCH_LENGTH),
	templateId: z.uuid(),
});
const valuesRequest = z.object({
	contactId: z.uuid(),
	salutation: salutationTextsSchema.refine(salutationWithinBounds),
	templateId: z.uuid(),
});
/** The most a form of an import carries as HTML before the server counts its bytes (500 KB). */
const htmlField = z.string().max(MAX_REQUEST_HTML);
const checkImportRequest = z.discriminatedUnion('target', [
	z.object({ html: htmlField, target: z.literal('globalLayout') }),
	z
		.object({
			areaId: z.uuid().optional(),
			html: htmlField,
			target: z.enum(['template', 'ownLayout']),
			templateId: z.uuid().optional(),
		})
		.refine(({ areaId, templateId }) => areaId !== undefined || templateId !== undefined),
]);
const createHtmlRequest = z.object({
	areaId: z.uuid(),
	html: htmlField,
	name: z.string().max(MAX_TEXT_INPUT),
	subject: z.string().max(MAX_TEXT_INPUT),
});
const replaceHtmlRequest = z.object({
	html: htmlField,
	id: z.uuid(),
	version: z.coerce.number().int().min(1),
});

const saveRequest = z.object({
	id: z.uuid(),
	input: templateInputSchema.refine(templateWithinBounds),
	version: z.int().min(1),
});

/**
 * The templates of the areas the user may read, and those areas with the right to change.
 */
const loadTemplateList = createServerFn({ method: 'GET' }).handler(
	async (): Promise<TemplateListPage> => {
		const [{ requireRequestPrincipal }, { listAreas }, { listTemplates }, { levelAtLeast }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/areas/areas'),
				import('@/server/templates/templates'),
				import('@/server/permissions/levels'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		const listed = await listAreas(context.db, principal);
		const areas = listed
			.filter(({ level }) => level !== null)
			.map(({ id, level, name }) => ({ canEdit: levelAtLeast(level, 'edit'), id, name }));
		const templates = await listTemplates(context.db, principal);
		return { areas, templates };
	},
);

/**
 * One template for its editor. A template that does not exist, or one in an area the user may not
 * read, is "not found": the page does not tell the two apart.
 */
const loadTemplateEditor = createServerFn({ method: 'GET' })
	.validator(pageRequest)
	.handler(async ({ data }): Promise<TemplateEditorPage> => {
		const [
			{ requireRequestPrincipal },
			{ loadTemplateEditorData },
			{ ForbiddenError },
			{ TemplateNotFoundError },
		] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/templates/editor-data'),
			import('@/server/permissions/principal'),
			import('@/server/templates/errors'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
		if (!z.uuid().safeParse(data.id).success) throw notFound();
		try {
			const editor = await loadTemplateEditorData(
				context.db,
				principal,
				data.id,
				context.env.appUrl.origin,
			);
			return { ...editor, appOrigin: context.env.appUrl.origin };
		} catch (error) {
			if (error instanceof TemplateNotFoundError || error instanceof ForbiddenError) {
				// oxlint-disable-next-line typescript/only-throw-error -- see above
				throw notFound();
			}
			throw error;
		}
	});

/**
 * Saves a template from its editor with the version it was loaded or last saved with. A newer
 * version, a template deleted meanwhile, a taken name, a vanished layout and the save checks'
 * problems come back as results.
 */
const submitTemplate = createServerFn({ method: 'POST' })
	.validator(saveRequest)
	.handler(async ({ data }): Promise<SaveTemplateResult> => {
		const [{ requireRequestPrincipal }, templates, { saveFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/templates/templates'),
			import('@/server/templates/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const saved = await templates.saveTemplate(
				context.db,
				principal,
				data.id,
				data.input,
				data.version,
				context.env.appUrl.origin,
			);
			return { ok: true, version: saved.version };
		} catch (error) {
			const failure = saveFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Creates a template, empty or from a starter, with the name and subject of the form. */
const submitCreateTemplate = createServerFn({ method: 'POST' })
	.validator(createRequest)
	.handler(async ({ data }): Promise<CreateTemplateResult> => {
		const [{ requireRequestPrincipal }, templates, { createFailure }, { emptyTemplate }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/templates/templates'),
				import('@/server/templates/failures'),
				import('@/mail/starters/starters'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		const names = { name: data.name, subject: data.subject };
		const { areaId, start } = data;
		try {
			const created =
				start === 'empty'
					? await templates.createTemplate(
							context.db,
							principal,
							areaId,
							emptyTemplate(names),
							context.env.appUrl.origin,
						)
					: await templates.createFromStarter(
							context.db,
							principal,
							areaId,
							start,
							names,
							context.env.appUrl.origin,
						);
			return { id: created.id, ok: true };
		} catch (error) {
			const failure = createFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Duplicates a template into an area where the user edits, under a new name. */
const submitDuplicate = createServerFn({ method: 'POST' })
	.validator(duplicateRequest)
	.handler(async ({ data }): Promise<DuplicateResult> => {
		const [{ requireRequestPrincipal }, templates, { duplicateFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/templates/templates'),
			import('@/server/templates/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const { id, name, targetAreaId } = data;
		try {
			const copy = await templates.duplicateTemplate(
				context.db,
				context.storage,
				principal,
				id,
				targetAreaId,
				name,
				context.env.appUrl.origin,
			);
			return { id: copy.id, ok: true };
		} catch (error) {
			const failure = duplicateFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Deletes a template, unless somebody saved it since the page loaded it. */
const submitDeleteTemplate = createServerFn({ method: 'POST' })
	.validator(deleteRequest)
	.handler(async ({ data }): Promise<DeleteTemplateResult> => {
		const [{ requireRequestPrincipal }, templates, { deleteFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/templates/templates'),
			import('@/server/templates/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await templates.deleteTemplate(context.db, principal, data.id, data.version);
			return { ok: true };
		} catch (error) {
			const failure = deleteFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/**
 * Searches the contacts a template can be previewed with: at most ten, only base fields are
 * searched. The search goes by POST, never into a URL. A template deleted meanwhile finds none.
 */
const searchPreviewContacts = createServerFn({ method: 'POST' })
	.validator(searchRequest)
	.handler(async ({ data }): Promise<{ contacts: readonly PreviewContact[] }> => {
		const [{ requireRequestPrincipal }, preview, { TemplateNotFoundError }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/templates/preview-values'),
			import('@/server/templates/errors'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			return {
				contacts: await preview.searchPreviewContacts(
					context.db,
					principal,
					data.templateId,
					data.query,
				),
			};
		} catch (error) {
			if (error instanceof TemplateNotFoundError) return { contacts: [] };
			throw error;
		}
	});

/**
 * The placeholder values of a contact for the preview of a template, with the salutation texts
 * as the editor holds them. A contact or template that is gone comes back as `gone`.
 */
const loadPreviewValues = createServerFn({ method: 'POST' })
	.validator(valuesRequest)
	.handler(async ({ data }): Promise<PreviewValuesResult> => {
		const [{ requireRequestPrincipal }, preview, { TemplateNotFoundError }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/templates/preview-values'),
			import('@/server/templates/errors'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const values = await preview.previewValues(
				context.db,
				principal,
				data.templateId,
				data.contactId,
				data.salutation,
			);
			return values === null ? { failure: 'gone', ok: false } : { ok: true, values };
		} catch (error) {
			if (error instanceof TemplateNotFoundError) return { failure: 'gone', ok: false };
			throw error;
		}
	});

/** The areas a template can be created in and what the preview of an import needs. */
const loadNewTemplate = createServerFn({ method: 'GET' }).handler(
	async (): Promise<NewTemplatePage> => {
		const [{ requireRequestPrincipal }, { listAreas }, { getBrand }, { levelAtLeast }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/areas/areas'),
				import('@/server/brand/brand'),
				import('@/server/permissions/levels'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		const listed = await listAreas(context.db, principal);
		const areas = listed
			.filter(({ level }) => level !== null)
			.map(({ id, level, name }) => ({ canEdit: levelAtLeast(level, 'edit'), id, name }));
		const { brand } = await getBrand(context.db);
		return { appOrigin: context.env.appUrl.origin, areas, brand };
	},
);

/**
 * Cleans and checks HTML for an import and says what it removed and what it refuses; nothing is
 * stored. The target decides what the HTML may use and who may import: `edit` in the area of a
 * template or its own layout, the admin role for a global layout. A template that is gone comes
 * back as `gone`.
 */
const checkHtmlImport = createServerFn({ method: 'POST' })
	.validator(fromForm(checkImportRequest))
	.handler(async ({ data }): Promise<CheckHtmlImportResult> => {
		const [{ requireRequestPrincipal }, check, { TemplateNotFoundError }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/templates/import-check'),
			import('@/server/templates/errors'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const result = await check.checkHtmlImport(
				context.db,
				principal,
				data,
				context.env.appUrl.origin,
			);
			return result.ok
				? { findings: result.findings, html: result.html, ok: true }
				: { ok: false, refusals: result.refusals };
		} catch (error) {
			if (error instanceof TemplateNotFoundError) return { failure: 'gone', ok: false };
			throw error;
		}
	});

/** Creates a template from imported HTML with the name and subject of the form. */
const submitCreateHtmlTemplate = createServerFn({ method: 'POST' })
	.validator(fromForm(createHtmlRequest))
	.handler(async ({ data }): Promise<CreateHtmlTemplateResult> => {
		const [{ requireRequestPrincipal }, templates, { createHtmlFailure }, { emptyTemplate }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/templates/templates'),
				import('@/server/templates/failures'),
				import('@/mail/starters/starters'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const created = await templates.createTemplate(
				context.db,
				principal,
				data.areaId,
				{
					...emptyTemplate({ name: data.name, subject: data.subject }),
					body: { html: data.html, kind: 'html' },
				},
				context.env.appUrl.origin,
			);
			return { id: created.id, ok: true };
		} catch (error) {
			const failure = createHtmlFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/**
 * Puts new HTML into an HTML template, with the version the page loaded. A newer version, a
 * template deleted meanwhile and the save checks' problems come back as results.
 */
const submitReplaceHtml = createServerFn({ method: 'POST' })
	.validator(fromForm(replaceHtmlRequest))
	.handler(async ({ data }): Promise<SaveTemplateResult> => {
		const [{ requireRequestPrincipal }, replace, { saveFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/templates/replace-html'),
			import('@/server/templates/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const saved = await replace.replaceTemplateHtml(
				context.db,
				principal,
				data.id,
				data.html,
				data.version,
				context.env.appUrl.origin,
			);
			return { ok: true, version: saved.version };
		} catch (error) {
			const failure = saveFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

export {
	checkHtmlImport,
	loadNewTemplate,
	loadPreviewValues,
	loadTemplateEditor,
	loadTemplateList,
	searchPreviewContacts,
	submitCreateHtmlTemplate,
	submitCreateTemplate,
	submitDeleteTemplate,
	submitDuplicate,
	submitReplaceHtml,
	submitTemplate,
};
export type {
	CheckHtmlImportResult,
	CreateHtmlTemplateResult,
	CreateTemplateResult,
	DeleteTemplateResult,
	DuplicateResult,
	NewTemplatePage,
	PreviewValuesResult,
	SaveTemplateResult,
	TemplateArea,
	TemplateEditorPage,
	TemplateListPage,
};
