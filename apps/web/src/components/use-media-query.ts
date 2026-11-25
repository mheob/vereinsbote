import { useMemo, useSyncExternalStore } from 'react';

interface MediaQueryStore {
	subscribe: (notify: () => void) => () => void;
	read: () => boolean;
}

/**
 * The external store of a media query.
 *
 * @param query The media query, e.g. `(min-width: 1024px)`.
 * @returns `subscribe` (calls back on every change, returns the unsubscribe) and `read` (matches now).
 */
function mediaQueryStore(query: string): MediaQueryStore {
	return {
		read: () => globalThis.matchMedia(query).matches,
		subscribe: (notify) => {
			const list = globalThis.matchMedia(query);
			list.addEventListener('change', notify);
			return () => {
				list.removeEventListener('change', notify);
			};
		},
	};
}

const readServer = (): boolean => false;

/**
 * Whether a media query matches. The server render and the hydration say false; the browser's
 * answer follows at once and on every change.
 *
 * @param query The media query, e.g. `(min-width: 1024px)`.
 * @returns True while the query matches.
 */
function useMediaQuery(query: string): boolean {
	const store = useMemo(() => mediaQueryStore(query), [query]);
	return useSyncExternalStore(store.subscribe, store.read, readServer);
}

export { mediaQueryStore, useMediaQuery };
