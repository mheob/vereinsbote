// oxlint-disable-next-line import/no-unassigned-import -- zod's settings must be in place before any schema parses
import './zod-config';
import { createRouter } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { cspNonceFor } from './platform/csp-nonce';
import { routerDefaults } from './router-defaults';
import { routeTree } from './routeTree.gen';
import type { SelfTestResult } from './server/sending/open-transport';

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}

	/** Notices for the next page, never in the URL (`components/contacts/history-notice.ts`). */
	interface HistoryState {
		/** The name of the partner just deleted; the contact list announces it once. */
		deletedContact?: string;
		/** An occasion was just deleted or archived on its page; the list announces it once. */
		occasionNotice?: { kind: 'archived' | 'deleted'; name: string };
		/** A partner was just created; its page announces „Gespeichert.“ once. */
		partnerSaved?: boolean;
		/** What the check of a new connection's credentials found; its page shows it once. */
		sendingCheck?: 'failed' | 'none' | 'ok' | 'unchecked';
		/** The self test a new sender just ran; its page shows it once. */
		sendingSelfTest?: SelfTestResult;
		/** A connection or sender was just created or deleted; the overview of the sending announces it. */
		sendingNotice?: {
			kind: 'connectionCreated' | 'connectionDeleted' | 'senderCreated' | 'senderDeleted';
			name: string;
		};
		/** A template was just copied (its page announces it) or deleted (the list announces it). */
		templateNotice?: { kind: 'copied' | 'deleted'; name: string };
		/**
		 * A wave was just confirmed in the send flow: its mails and its planned start (an ISO
		 * instant, null for at once); the occasion's page announces it once.
		 */
		waveNotice?: { mails: number; notBefore: string | null };
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
