import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import type { ContactDetail } from '@/server/contacts/contacts';
import type { ContactGone } from '@/server/contacts/errors';
import { contactListQuerySchema } from '@/server/contacts/list-query';
import { partnerInputSchema } from '@/server/contacts/partner-form';
import type { PartnerForm, PartnerSaveResult } from '@/server/contacts/partners';

/*
 * The server functions of the contact pages. Server modules are imported inside the handlers, so
 * they stay out of the client bundle. Each handler checks the session itself and the domain
 * functions check the access: server functions are reachable without their page.
 */

/** HTTP status of the contact pages for a signed-in user without access to contacts. */
const HTTP_FORBIDDEN = 403;

/** The result of a change to a contact. */
type ContactChangeResult = Readonly<{ ok: true }> | ContactGone;

/** The result of an opt-out; its area may be gone as well. */
type OptOutResult = ContactChangeResult | Readonly<{ ok: false; failure: 'areaNotFound' }>;

/** The partner form; without `edit` in the partners area only `canManage: false`. */
type PartnerFormPage =
	| Readonly<{ canManage: false }>
	| (Readonly<{ canManage: true }> & PartnerForm);

/** The longest address part of a contact page the server looks at; ids are 36 characters. */
const MAX_CONTACT_PAGE_ID_LENGTH = 100;

/**
 * The address of a contact page. Any text: an id that is no contact's is "not found", like an
 * unknown one.
 */
const contactPageRequest = z.object({ contactId: z.string().max(MAX_CONTACT_PAGE_ID_LENGTH) });

const contactRequest = z.object({ contactId: z.uuid() });

const suppressionRequest = contactRequest.extend({ suppressed: z.boolean() });

const optOutRequest = contactRequest.extend({ areaId: z.uuid(), optedOut: z.boolean() });

const partnerFormRequest = z.object({ contactId: z.uuid().optional() });

const partnerRequest = partnerInputSchema.extend({ contactId: z.uuid().optional() });

/**
 * What the signed-in user may do with contacts, for the contacts layout and the titles of its
 * pages. Without `read` in any area the page is "no access" with status 403. Only the flags go
 * to the browser, not the visible fields.
 */
const loadContactsAccess = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ setResponseStatus }, { requireRequestPrincipal }, { loadContactAccess }] =
		await Promise.all([
			import('@tanstack/react-start/server'),
			import('@/platform/request-principal'),
			import('@/server/contacts/access'),
		]);
	const { context, principal } = await requireRequestPrincipal();
	const { canList, canManage } = await loadContactAccess(context.db, principal);
	// The status of the page when the server renders it; a client-side navigation ignores it.
	if (!canList) setResponseStatus(HTTP_FORBIDDEN);
	return { canList, canManage: { member: canManage.member, partner: canManage.partner } };
});

/**
 * One page of a kind with search and filters. A POST, so the search and the filter values never
 * appear in a URL (design 13).
 */
const searchContacts = createServerFn({ method: 'POST' })
	.validator(contactListQuerySchema)
	.handler(async ({ data }) => {
		const [{ requireRequestPrincipal }, { listContacts }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/contacts'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		return listContacts(context.db, principal, data, new Date());
	});

/**
 * One contact as the user may see it: protected values only with the right. An unknown contact
 * is "not found".
 */
const loadContact = createServerFn({ method: 'GET' })
	.validator(contactPageRequest)
	.handler(async ({ data }): Promise<ContactDetail> => {
		const [{ requireRequestPrincipal }, { getContact }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/contacts'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const contact = await getContact(context.db, principal, data.contactId);
		// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
		if (contact === null) throw notFound();
		return contact;
	});

/** Suppresses a contact ("no more mail") or lifts the suppression. */
const submitSuppression = createServerFn({ method: 'POST' })
	.validator(suppressionRequest)
	.handler(async ({ data }): Promise<ContactChangeResult> => {
		const [
			{ requireRequestPrincipal },
			{ setSuppression },
			{ CONTACT_GONE, ContactNotFoundError },
		] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/suppressions'),
			import('@/server/contacts/errors'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await setSuppression(context.db, principal, data.contactId, data.suppressed);
			return { ok: true };
		} catch (error) {
			if (error instanceof ContactNotFoundError) return CONTACT_GONE;
			throw error;
		}
	});

/** Records or removes a contact's objection to the mail of one area. */
const submitOptOut = createServerFn({ method: 'POST' })
	.validator(optOutRequest)
	.handler(async ({ data }): Promise<OptOutResult> => {
		const [{ requireRequestPrincipal }, suppressions, { CONTACT_GONE, ContactNotFoundError }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/contacts/suppressions'),
				import('@/server/contacts/errors'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await suppressions.setOptOut(context.db, principal, data);
			return { ok: true };
		} catch (error) {
			if (error instanceof ContactNotFoundError) return CONTACT_GONE;
			if (error instanceof suppressions.UnknownAreaError) {
				return { failure: 'areaNotFound', ok: false };
			}
			throw error;
		}
	});

/**
 * The partner form: the fields the user sees, the tag suggestions and, to edit a partner, its
 * values. Without `edit` in the partners area the page is "no access" with status 403; an
 * unknown partner is "not found".
 */
const loadPartnerForm = createServerFn({ method: 'GET' })
	.validator(partnerFormRequest)
	.handler(async ({ data }): Promise<PartnerFormPage> => {
		const [
			{ setResponseStatus },
			{ requireRequestPrincipal },
			{ getPartnerForm },
			{ ContactNotFoundError },
			{ ForbiddenError },
		] = await Promise.all([
			import('@tanstack/react-start/server'),
			import('@/platform/request-principal'),
			import('@/server/contacts/partners'),
			import('@/server/contacts/errors'),
			import('@/server/permissions/principal'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const form = await getPartnerForm(context.db, principal, data.contactId ?? null);
			return { ...form, canManage: true };
		} catch (error) {
			// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
			if (error instanceof ContactNotFoundError) throw notFound();
			if (!(error instanceof ForbiddenError)) throw error;
			// The status of the page when the server renders it; a client-side navigation ignores it.
			setResponseStatus(HTTP_FORBIDDEN);
			return { canManage: false };
		}
	});

/**
 * Creates a partner, or edits the one `contactId` names. Refused fields come back with their
 * reason, a customer number another partner has as `taken`.
 */
const submitPartner = createServerFn({ method: 'POST' })
	.validator(partnerRequest)
	.handler(async ({ data }): Promise<PartnerSaveResult> => {
		const [{ requireRequestPrincipal }, { savePartner }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/partners'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		return savePartner(context.db, principal, data);
	});

/** Deletes a partner; its suppression and opt-outs stay with its key. */
const submitDeletePartner = createServerFn({ method: 'POST' })
	.validator(contactRequest)
	.handler(async ({ data }): Promise<ContactChangeResult> => {
		const [{ requireRequestPrincipal }, { deletePartner }, { CONTACT_GONE, ContactNotFoundError }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/contacts/partners'),
				import('@/server/contacts/errors'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await deletePartner(context.db, principal, data.contactId);
			return { ok: true };
		} catch (error) {
			if (error instanceof ContactNotFoundError) return CONTACT_GONE;
			throw error;
		}
	});

export {
	loadContact,
	loadContactsAccess,
	loadPartnerForm,
	searchContacts,
	submitDeletePartner,
	submitOptOut,
	submitPartner,
	submitSuppression,
};
export type { ContactChangeResult, OptOutResult, PartnerFormPage };
