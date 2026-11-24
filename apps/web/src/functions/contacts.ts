import { createServerFn } from '@tanstack/react-start';

import { contactListQuerySchema } from '@/server/contacts/list-query';

/*
 * The server functions of the contact pages. Server modules are imported inside the handlers, so
 * they stay out of the client bundle. Each handler checks the session itself and the domain
 * functions check the access: server functions are reachable without their page.
 */

/** HTTP status of the contact pages for a signed-in user without access to contacts. */
const HTTP_FORBIDDEN = 403;

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

export { loadContactsAccess, searchContacts };
