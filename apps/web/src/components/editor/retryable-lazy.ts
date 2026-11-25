/*
 * A component loaded by `import()` that can be loaded again after its load failed (a network
 * error, or a deploy that replaced the chunk). React's `lazy` keeps a failed load failed for good,
 * so a retry needs a new lazy component; the fields of a page share the one that loaded.
 */
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/** A lazily loaded component and the way to load it again. */
interface RetryableLazy<P extends object> {
	/** The component to render: the same one until a load failed and `retry` was called. */
	readonly current: () => LazyExoticComponent<ComponentType<P>>;
	/** After a failed load, has the next render load the module again; else changes nothing. */
	readonly retry: () => void;
}

/**
 * Wraps a dynamic import of a component, so that a failed load can be tried again.
 *
 * @param load Loads the module and returns the component.
 * @returns The component of the latest load, and the retry.
 */
function retryableLazy<P extends object>(load: () => Promise<ComponentType<P>>): RetryableLazy<P> {
	let failed = false;
	const create = (): LazyExoticComponent<ComponentType<P>> =>
		lazy(async () => {
			try {
				return { default: await load() };
			} catch (error) {
				failed = true;
				throw error;
			}
		});
	let component = create();
	return {
		current: () => component,
		retry: () => {
			if (!failed) return;
			failed = false;
			component = create();
		},
	};
}

export { retryableLazy };
export type { RetryableLazy };
