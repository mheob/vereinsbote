import { useSyncExternalStore } from 'react';

/**
 * Never notifies: whether the page is hydrated changes once, from the server render to the first
 * client render, and React handles that switch itself.
 *
 * @returns The unsubscribe function.
 */
function subscribe(): () => void {
	return () => {
		// Nothing to unsubscribe.
	};
}

const onClient = (): boolean => true;
const onServer = (): boolean => false;

/**
 * Tells whether React runs the page: false in the server render and while hydrating, true from
 * the first client render on (and at once after a client-side navigation). Until then, a form
 * submitted in the browser would bypass its `onSubmit` handler.
 *
 * @returns True once the page is hydrated.
 */
export function useHydrated(): boolean {
	return useSyncExternalStore(subscribe, onClient, onServer);
}
