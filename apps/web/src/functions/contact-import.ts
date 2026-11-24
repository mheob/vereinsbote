import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { CONTACT_KINDS } from '@/server/contacts/fields';
import { parseImportFormData } from '@/server/contacts/import/form-data';
import type { ImportFormRequest } from '@/server/contacts/import/form-data';
import type { SavedMapping } from '@/server/contacts/import/mapping';
import type { MemberImportPreview } from '@/server/contacts/import/members';
import type { PartnerImportPreview } from '@/server/contacts/import/partners';
import type { ImportPayload } from '@/server/contacts/import/payload';
import type { ConfirmImportResult } from '@/server/contacts/import/plan';
import type { CustomFieldRecord } from '@/server/contacts/settings';

/*
 * The server functions of the import wizard. The browser reads the file and sends only the mapped
 * columns, compressed, as form data (`toImportFormData`); preview and confirm decode the same
 * payload, so nothing is stored between the steps. Server modules are imported inside the
 * handlers, so they stay out of the client bundle. Each handler checks the session and the right
 * to import the kind before it decodes the payload (the import functions check the right again):
 * server functions are reachable without their page.
 */

/** HTTP status of the import page for a user without the right to import the kind. */
const HTTP_FORBIDDEN = 403;

/** Why a payload was not read: above a size limit, or not a valid payload of the kind. */
type PayloadFailure = Readonly<{ ok: false; failure: 'payloadInvalid' | 'payloadTooLarge' }>;

/** What the import page needs; without the right only `canImport: false`. */
type ImportPage = Readonly<{
	canImport: boolean;
	savedMapping: SavedMapping | null;
	customFields: readonly Readonly<CustomFieldRecord>[];
	/** ISO instant of the last confirmed import of the kind. */
	lastImportAt: string | null;
}>;

type PreviewImportResult =
	| Readonly<{ ok: true; kind: 'member'; preview: MemberImportPreview }>
	| Readonly<{ ok: true; kind: 'partner'; preview: PartnerImportPreview }>
	| PayloadFailure;

type ConfirmImportResponse = ConfirmImportResult | PayloadFailure;

const kindRequest = z.object({ kind: z.enum(CONTACT_KINDS) });

/**
 * Reads the form of a confirm, which names the stock version it confirms.
 *
 * @param data What the server function received.
 * @returns The request.
 * @throws {Error} For a malformed form or one without stock version.
 */
function parseConfirmFormData(
	data: unknown,
): ImportFormRequest & { readonly stockVersion: number } {
	const request = parseImportFormData(data);
	const { stockVersion } = request;
	if (stockVersion === null) throw new TypeError('A confirm names the stock version.');
	return { ...request, stockVersion };
}

/**
 * Decodes the payload of a request: it must be valid and of the request's kind.
 *
 * @param request The request.
 * @returns The payload, or why it was not read.
 */
async function readPayload(request: ImportFormRequest): Promise<ImportPayload | PayloadFailure> {
	const { decodeImportPayload, ImportPayloadError } =
		await import('@/server/contacts/import/payload');
	try {
		const payload = await decodeImportPayload(request.payload);
		return payload.kind === request.kind ? payload : { failure: 'payloadInvalid', ok: false };
	} catch (error) {
		if (!(error instanceof ImportPayloadError)) throw error;
		return {
			failure: error.reason === 'tooLarge' ? 'payloadTooLarge' : 'payloadInvalid',
			ok: false,
		};
	}
}

/**
 * Tells whether a decoded payload was refused.
 *
 * @param payload The payload, or why it was not read.
 * @returns True for a refusal.
 */
function isPayloadFailure(payload: ImportPayload | PayloadFailure): payload is PayloadFailure {
	return 'ok' in payload;
}

/**
 * The import page of a kind: the saved mapping, the custom fields of the kind and the time of the
 * last import. Without `edit` in the area of the kind the page is "no access" with status 403.
 */
const loadImportPage = createServerFn({ method: 'GET' })
	.validator(kindRequest)
	.handler(async ({ data }): Promise<ImportPage> => {
		const [
			{ setResponseStatus },
			{ requireRequestPrincipal },
			{ loadContactAccess },
			{ getImportState },
			{ savedMappingSchema },
			{ listCustomFields },
		] = await Promise.all([
			import('@tanstack/react-start/server'),
			import('@/platform/request-principal'),
			import('@/server/contacts/access'),
			import('@/server/contacts/import-state'),
			import('@/server/contacts/import/mapping'),
			import('@/server/contacts/settings'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const access = await loadContactAccess(context.db, principal);
		if (!access.canManage[data.kind]) {
			// The status of the page when the server renders it; a client-side navigation ignores it.
			setResponseStatus(HTTP_FORBIDDEN);
			return { canImport: false, customFields: [], lastImportAt: null, savedMapping: null };
		}
		const [state, customFields] = await Promise.all([
			getImportState(context.db, data.kind),
			listCustomFields(context.db, data.kind),
		]);
		// A mapping saved by an older version that the schema no longer takes is not suggested.
		const saved = savedMappingSchema.safeParse(state.mapping);
		return {
			canImport: true,
			customFields,
			lastImportAt: state.lastConfirmedAt?.toISOString() ?? null,
			savedMapping: saved.success ? saved.data : null,
		};
	});

/**
 * Previews an import: what the payload would change in the stock of its kind. Nothing is stored.
 * Without `edit` in the area of the kind it throws `ForbiddenError` before the payload is decoded;
 * a payload above a size limit or not of the request's kind is refused as a result.
 */
const previewImport = createServerFn({ method: 'POST' })
	.validator(parseImportFormData)
	.handler(async ({ data }): Promise<PreviewImportResult> => {
		const [
			{ requireRequestPrincipal },
			{ assertCanManage, loadContactAccess },
			{ previewMemberImport },
			{ previewPartnerImport },
		] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/access'),
			import('@/server/contacts/import/members'),
			import('@/server/contacts/import/partners'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		// The right first, outside any transaction: without it the payload is never decoded.
		assertCanManage(await loadContactAccess(context.db, principal), data.kind);
		const payload = await readPayload(data);
		if (isPayloadFailure(payload)) return payload;
		const now = new Date();
		return data.kind === 'member'
			? {
					kind: 'member',
					ok: true,
					preview: await previewMemberImport(context.db, principal, payload, now),
				}
			: {
					kind: 'partner',
					ok: true,
					preview: await previewPartnerImport(context.db, principal, payload, now),
				};
	});

/**
 * Confirms an import with the payload of its preview: members replace the stock (with the
 * confirmed number of deletions), partners are matched (with the ticked partners to delete).
 * Refusals (`stockChanged`, `blocked`, `confirmationRequired`, a refused payload) are results;
 * without `edit` in the area of the kind it throws `ForbiddenError` before the payload is decoded.
 */
const confirmImport = createServerFn({ method: 'POST' })
	.validator(parseConfirmFormData)
	.handler(async ({ data }): Promise<ConfirmImportResponse> => {
		const [
			{ requireRequestPrincipal },
			{ assertCanManage, loadContactAccess },
			{ confirmMemberImport },
			{ confirmPartnerImport },
		] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/access'),
			import('@/server/contacts/import/members'),
			import('@/server/contacts/import/partners'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		// The right first, outside any transaction: without it the payload is never decoded.
		assertCanManage(await loadContactAccess(context.db, principal), data.kind);
		const payload = await readPayload(data);
		if (isPayloadFailure(payload)) return payload;
		const now = new Date();
		const { confirmedDeletions, deleteIds, stockVersion } = data;
		return data.kind === 'member'
			? confirmMemberImport(
					context.db,
					principal,
					payload,
					{ confirmedDeletions, stockVersion },
					now,
				)
			: confirmPartnerImport(context.db, principal, payload, { deleteIds, stockVersion }, now);
	});

export { confirmImport, loadImportPage, previewImport };
export type { ConfirmImportResponse, ImportPage, PayloadFailure, PreviewImportResult };
