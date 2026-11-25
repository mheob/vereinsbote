// oxlint-disable-next-line import/no-unassigned-import -- zod's settings must be in place before any schema parses
import './zod-config';
import { createRouter } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { cspNonceFor } from './platform/csp-nonce';
import { routerDefaults } from './router-defaults';
import { routeTree } from './routeTree.gen';

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}

	/** Notices for the next page, never in the URL (`components/contacts/history-notice.ts`). */
	interface HistoryState {
		/** The name of the partner just deleted; the contact list announces it once. */
		deletedContact?: string;
		/** A partner was just created; its page announces „Gespeichert.“ once. */
		partnerSaved?: boolean;
	}
}

/**
 * The Content Security Policy nonce of the request on the server (the same value as in the
 * response header), nothing in the browser, which reads it from the document.
 */
const serverNonce = createIsomorphicFn().server(() => cspNonceFor(getRequest()));

export function getRouter() {
	// The nonce goes in when the router is made (TanStack/router issue #8789); Start puts it on
	// its scripts and React Aria reads it from the `csp-nonce` meta tag.
	return createRouter({ ...routerDefaults, routeTree, ssr: { nonce: serverNonce() } });
}
