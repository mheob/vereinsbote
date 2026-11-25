import { useEffect, useState } from 'react';

/**
 * A value that follows another one after it has stayed the same for a while.
 *
 * @param value The value; give the same one while it does not change.
 * @param delayMs How long it must stay unchanged.
 * @returns The value as of `delayMs` ago; the first value at the start.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebounced(value);
		}, delayMs);
		return () => {
			clearTimeout(timer);
		};
	}, [value, delayMs]);
	return debounced;
}
