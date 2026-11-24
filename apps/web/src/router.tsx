import { createRouter } from '@tanstack/react-router';

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

export function getRouter() {
	return createRouter({ ...routerDefaults, routeTree });
}
