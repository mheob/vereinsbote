import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { STARTER_IDS } from '@/mail/starters/starters';
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

/** One template as its page shows it. */
interface TemplatePage {
	readonly id: string;
	readonly name: string;
	readonly subject: string;
	readonly bodyKind: 'blocks' | 'html';
	readonly areaId: string;
	readonly areaName: string;
	readonly version: number;
	readonly canEdit: boolean;
	readonly updatedAt: Date;
	/** Null when that user no longer exists. */
	readonly updatedByName: string | null;
}

type CreateTemplateResult = Readonly<
	{ ok: true; id: string } | { ok: false; failure: 'nameTaken' | 'invalid' | 'gone' }
>;

type DuplicateResult = Readonly<
	| { ok: true; id: string }
	| { ok: false; failure: 'nameTaken' | 'storageMissing' | 'gone' }
	| { ok: false; failure: 'forbiddenPlaceholders'; keys: readonly string[] }
>;

type DeleteTemplateResult = Readonly<{ ok: true } | { ok: false; failure: 'changed' | 'gone' }>;

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
 * One template for its page. A template that does not exist, or one in an area the user may not
 * read, is "not found": the page does not tell the two apart.
 */
const loadTemplatePage = createServerFn({ method: 'GET' })
	.validator(pageRequest)
	.handler(async ({ data }): Promise<TemplatePage> => {
		const [
			{ requireRequestPrincipal },
			{ listAreas },
			templates,
			{ ForbiddenError, canAccessArea },
			{ TemplateNotFoundError },
		] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/areas/areas'),
			import('@/server/templates/templates'),
			import('@/server/permissions/principal'),
			import('@/server/templates/errors'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
		if (!z.uuid().safeParse(data.id).success) throw notFound();
		try {
			const record = await templates.getTemplate(context.db, principal, data.id);
			const listed = await listAreas(context.db, principal);
			return {
				areaId: record.areaId,
				areaName: listed.find(({ id }) => id === record.areaId)?.name ?? '',
				bodyKind: record.body.kind,
				canEdit: canAccessArea(principal, record.areaId, 'edit'),
				id: record.id,
				name: record.name,
				subject: record.subject,
				updatedAt: record.updatedAt,
				updatedByName: record.updatedByName,
				version: record.version,
			};
		} catch (error) {
			if (error instanceof TemplateNotFoundError || error instanceof ForbiddenError) {
				// oxlint-disable-next-line typescript/only-throw-error -- see above
				throw notFound();
			}
			throw error;
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
					? await templates.createTemplate(context.db, principal, areaId, emptyTemplate(names))
					: await templates.createFromStarter(context.db, principal, areaId, start, names);
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

export {
	loadTemplateList,
	loadTemplatePage,
	submitCreateTemplate,
	submitDeleteTemplate,
	submitDuplicate,
};
export type {
	CreateTemplateResult,
	DeleteTemplateResult,
	DuplicateResult,
	TemplateArea,
	TemplateListPage,
	TemplatePage,
};
