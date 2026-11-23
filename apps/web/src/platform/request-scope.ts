interface ScopedHandle<T> {
	value: T;
	end: () => Promise<void>;
}

interface RequestScopeOptions<T> {
	/** Opens the resource of one request. */
	create: () => Promise<ScopedHandle<T>>;
	/** Keeps the runtime alive until the promise settles, like `ctx.waitUntil` on Workers. */
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
	waitUntil: (promise: Promise<unknown>) => Promise<void> | void;
}

interface RequestScope<T> {
	/** Returns the resource of the request, opened on first use and shared by later calls. */
	get: (request: object) => Promise<T>;
	/** Ends the resource of the request, if one was opened, via `waitUntil`. */
	release: (request: object) => Promise<void>;
}

/**
 * Scopes a resource to one request. Workers must not share an I/O object (such as a database
 * WebSocket) across requests, so each request opens its own and ends it after the response.
 *
 * @param options How to open the resource and how to keep the runtime alive while it ends.
 * @returns Accessors keyed by the request object.
 */
function createRequestScope<T>(options: Readonly<RequestScopeOptions<T>>): RequestScope<T> {
	const handles = new WeakMap<object, Promise<ScopedHandle<T>>>();

	return {
		async get(request) {
			let handle = handles.get(request);
			if (!handle) {
				handle = options.create();
				handles.set(request, handle);
			}
			const { value } = await handle;
			return value;
		},
		async release(request) {
			const handle = handles.get(request);
			if (!handle) return;
			handles.delete(request);
			try {
				const { end } = await handle;
				await options.waitUntil(end());
			} catch {
				// Opening failed, so there is nothing to end; the caller of `get` saw the error.
			}
		},
	};
}

export { createRequestScope };
export type { RequestScope, RequestScopeOptions, ScopedHandle };
