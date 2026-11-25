import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { brandSchema } from '@/mail/brand/brand-schema';
import type { Brand } from '@/mail/brand/brand-schema';
import type { Db } from '@/server/db/client';
import type { Principal } from '@/server/permissions/principal';

/*
 * The server functions of the brand (CD) page. Server modules are imported inside the handlers, so
 * they stay out of the client bundle. Each handler checks the session itself and the admin role:
 * server functions are reachable without their page.
 */

/** What the brand page shows. */
interface BrandPage {
	readonly brand: Brand;
	/** 0 until the first save; the form sends it back, so a save over a newer one is refused. */
	readonly version: number;
	/** False until the brand was saved once; the start page then offers to set it up. */
	readonly configured: boolean;
	/** The origin of the app, for the preview's image addresses. */
	readonly appOrigin: string;
	/** Whether logos can be uploaded. */
	readonly storageReady: boolean;
}

/**
 * A saved brand, or why it was refused: another admin saved first (`changed`), a logo is no brand
 * image any more (`unknownLogo`), or the brand does not pass the schema (`invalid`).
 */
type SubmitBrandResult =
	| Readonly<{ ok: true; version: number }>
	| Readonly<{ ok: false; failure: 'changed' | 'unknownLogo' | 'invalid' }>;

/** The brand is checked in the handler, so a refusal is a result and not a generic failure. */
const submitBrandRequest = z.object({ brand: z.unknown(), version: z.int().min(0) });

/** The brand of the club with what the page needs; for admins only. */
const loadBrandPage = createServerFn({ method: 'GET' }).handler(async (): Promise<BrandPage> => {
	const [{ requireRequestPrincipal }, { assertAdmin }, { getBrand }] = await Promise.all([
		import('@/platform/request-principal'),
		import('@/server/permissions/principal'),
		import('@/server/brand/brand'),
	]);
	const { context, principal } = await requireRequestPrincipal();
	assertAdmin(principal);
	const state = await getBrand(context.db);
	return {
		...state,
		appOrigin: context.env.appUrl.origin,
		storageReady: context.storage !== null,
	};
});

/**
 * Saves the checked brand; a version or logo the database refuses is a result.
 *
 * @param db The database.
 * @param principal The admin.
 * @param input The brand and the version the form was loaded with.
 * @param input.brand The checked brand.
 * @param input.version The version the form was loaded with.
 * @returns The new version, or why it was refused.
 */
async function saveChecked(
	db: Db,
	principal: Readonly<Principal>,
	input: Readonly<{ brand: Brand; version: number }>,
): Promise<SubmitBrandResult> {
	const { BrandChangedError, saveBrand, UnknownLogoError } = await import('@/server/brand/brand');
	try {
		const { version } = await saveBrand(db, principal, input);
		return { ok: true, version };
	} catch (error) {
		if (error instanceof BrandChangedError) return { failure: 'changed', ok: false };
		if (error instanceof UnknownLogoError) return { failure: 'unknownLogo', ok: false };
		throw error;
	}
}

/** Saves the brand. The server checks it again and takes the logos' type and size from storage. */
const submitBrand = createServerFn({ method: 'POST' })
	.validator(submitBrandRequest)
	.handler(async ({ data }): Promise<SubmitBrandResult> => {
		const [{ requireRequestPrincipal }, { assertAdmin }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/permissions/principal'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		assertAdmin(principal);
		const parsed = brandSchema.safeParse(data.brand);
		if (!parsed.success) return { failure: 'invalid', ok: false };
		return saveChecked(context.db, principal, { brand: parsed.data, version: data.version });
	});

export { loadBrandPage, submitBrand };
export type { BrandPage, SubmitBrandResult };
