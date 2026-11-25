import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { mediaQueryStore, useMediaQuery } from './use-media-query';

/**
 * Replaces `matchMedia` with a stand-in: a flag and the listeners of its `change` event.
 *
 * @param initial Whether the query matches at first.
 * @returns The listeners and a function that changes the flag and fires the event.
 */
function stubMatchMedia(initial: boolean): {
	listeners: Set<() => void>;
	setMatches: (value: boolean) => void;
} {
	const listeners = new Set<() => void>();
	let matches = initial;
	vi.stubGlobal('matchMedia', () => ({
		addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
		get matches() {
			return matches;
		},
		removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
	}));
	return {
		listeners,
		setMatches: (value) => {
			matches = value;
			for (const listener of listeners) listener();
		},
	};
}

function Probe(): ReactNode {
	return String(useMediaQuery('(min-width: 1024px)'));
}

describe(useMediaQuery, () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('is false in the server render, whatever the query says', () => {
		stubMatchMedia(true);
		expect(renderToStaticMarkup(<Probe />)).toBe('false');
	});
});

describe(mediaQueryStore, () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads whether the query matches', () => {
		const media = stubMatchMedia(true);
		const store = mediaQueryStore('(min-width: 1024px)');
		expect(store.read()).toBe(true);
		media.setMatches(false);
		expect(store.read()).toBe(false);
	});

	it('notifies on a change and stops after the unsubscribe', () => {
		const media = stubMatchMedia(false);
		const calls: number[] = [];
		const notify = (): void => {
			calls.push(1);
		};
		const unsubscribe = mediaQueryStore('(min-width: 1024px)').subscribe(notify);
		media.setMatches(true);
		expect(calls).toHaveLength(1);
		unsubscribe();
		expect(media.listeners.size).toBe(0);
		media.setMatches(false);
		expect(calls).toHaveLength(1);
	});
});
