import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches. The server render and the hydration say false; the browser's
 * answer follows at once and on every change.
 *
 * @param query The media query, e.g. `(min-width: 1024px)`.
 * @returns True while the query matches.
 */
export function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(notify: () => void) => {
			const list = globalThis.matchMedia(query);
			list.addEventListener('change', notify);
			return () => {
				list.removeEventListener('change', notify);
			};
		},
		[query],
	);
	const read = useCallback(() => globalThis.matchMedia(query).matches, [query]);
	const readServer = useCallback(() => false, []);
	return useSyncExternalStore(subscribe, read, readServer);
}
