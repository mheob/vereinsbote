import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { fromForm } from '@/functions/from-form';
import type { Brand } from '@/mail/brand/brand-schema';
import type { ImportRefusal } from '@/server/html-import/import-html';
import type { LayoutFailure } from '@/server/layouts/failures';
import type { LayoutRecord, LayoutSummary } from '@/server/layouts/layouts';

/*
 * The server functions of the global layouts. Server modules are imported inside the handlers, so
 * they stay out of the client bundle. Each handler checks the session itself and the admin role:
 * server functions are reachable without their page. The HTML goes by POST in form data; the
 * refusals of the import and of the database come back as results.
 */

/** What the page of the layouts shows, with what the preview of an import needs. */
interface LayoutListPage {
	readonly layouts: readonly Readonly<LayoutSummary>[];
	readonly brand: Brand;
	/** The origin of the app, for the preview's image addresses. */
	readonly appOrigin: string;
}

/** A layout for its page, with what the preview of a replacement needs. */
interface LayoutPage {
	readonly layout: Readonly<LayoutRecord>;
	readonly brand: Brand;
	readonly appOrigin: string;
}

type RefusedImport = Readonly<{
	ok: false;
	failure: 'refused';
	refusals: readonly ImportRefusal[];
}>;

type CreateLayoutResult = Readonly<{ ok: true; id: string }> | RefusedImport | LayoutFailure;
type ReplaceLayoutResult = Readonly<{ ok: true; version: number }> | RefusedImport | LayoutFailure;
type DeleteLayoutResult = Readonly<{ ok: true }> | LayoutFailure;

/** The most a form carries as HTML before the server counts its bytes (500 KB). */
const MAX_HTML_CHARACTERS = 4_000_000;
/** The longest id the server looks at; ids are 36 characters. */
const MAX_ID_LENGTH = 100;
/** The longest name accepted before the layout's own limit (100 characters). */
const MAX_NAME_INPUT = 10_000;
const htmlField = z.string().max(MAX_HTML_CHARACTERS);

const createRequest = z.object({ html: htmlField, name: z.string().max(MAX_NAME_INPUT) });
const replaceRequest = z.object({
	html: htmlField,
	id: z.uuid(),
	version: z.coerce.number().int().min(1),
});
const pageRequest = z.object({ id: z.string().max(MAX_ID_LENGTH) });
const deleteRequest = z.object({ id: z.uuid() });

/** The layouts with the number of templates that use each; for admins only. */
const loadLayoutList = createServerFn({ method: 'GET' }).handler(
	async (): Promise<LayoutListPage> => {
		const [{ requireRequestPrincipal }, { listLayouts }, { getBrand }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/layouts/layouts'),
			import('@/server/brand/brand'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const layouts = await listLayouts(context.db, principal);
		const { brand } = await getBrand(context.db);
		return { appOrigin: context.env.appUrl.origin, brand, layouts };
	},
);

/** One layout with its HTML; a layout that does not exist is "not found". For admins only. */
const loadLayoutPage = createServerFn({ method: 'GET' })
	.validator(pageRequest)
	.handler(async ({ data }): Promise<LayoutPage> => {
		const [{ requireRequestPrincipal }, { getLayout }, { getBrand }, { LayoutNotFoundError }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/layouts/layouts'),
				import('@/server/brand/brand'),
				import('@/server/templates/errors'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
		if (!z.uuid().safeParse(data.id).success) throw notFound();
		try {
			const layout = await getLayout(context.db, principal, data.id);
			const { brand } = await getBrand(context.db);
			return { appOrigin: context.env.appUrl.origin, brand, layout };
		} catch (error) {
			// oxlint-disable-next-line typescript/only-throw-error -- see above
			if (error instanceof LayoutNotFoundError) throw notFound();
			throw error;
		}
	});

/** Creates a global layout from imported HTML. */
const submitCreateLayout = createServerFn({ method: 'POST' })
	.validator(fromForm(createRequest))
	.handler(async ({ data }): Promise<CreateLayoutResult> => {
		const [{ requireRequestPrincipal }, layouts, { layoutFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/layouts/layouts'),
			import('@/server/layouts/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const created = await layouts.createLayout(
				context.db,
				principal,
				{ name: data.name, source: data.html },
				context.env.appUrl.origin,
			);
			return 'refusals' in created
				? { failure: 'refused', ok: false, refusals: created.refusals }
				: { id: created.id, ok: true };
		} catch (error) {
			const failure = layoutFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Replaces the HTML of a layout, with the version the page loaded. */
const submitReplaceLayout = createServerFn({ method: 'POST' })
	.validator(fromForm(replaceRequest))
	.handler(async ({ data }): Promise<ReplaceLayoutResult> => {
		const [{ requireRequestPrincipal }, layouts, { layoutFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/layouts/layouts'),
			import('@/server/layouts/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const replaced = await layouts.replaceLayout(
				context.db,
				principal,
				data.id,
				data.html,
				data.version,
				context.env.appUrl.origin,
			);
			return 'refusals' in replaced
				? { failure: 'refused', ok: false, refusals: replaced.refusals }
				: { ok: true, version: replaced.version };
		} catch (error) {
			const failure = layoutFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Deletes a layout no template uses; a layout in use comes back with the number of templates. */
const submitDeleteLayout = createServerFn({ method: 'POST' })
	.validator(deleteRequest)
	.handler(async ({ data }): Promise<DeleteLayoutResult> => {
		const [{ requireRequestPrincipal }, layouts, { layoutFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/layouts/layouts'),
			import('@/server/layouts/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await layouts.deleteLayout(context.db, principal, data.id);
			return { ok: true };
		} catch (error) {
			const failure = layoutFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

export {
	loadLayoutList,
	loadLayoutPage,
	submitCreateLayout,
	submitDeleteLayout,
	submitReplaceLayout,
};
export type {
	CreateLayoutResult,
	DeleteLayoutResult,
	LayoutListPage,
	LayoutPage,
	ReplaceLayoutResult,
};
