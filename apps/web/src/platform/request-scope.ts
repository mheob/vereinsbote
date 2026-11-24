interface ScopedHandle<T> {
	value: T;
	end: () => Promise<void>;
}

interface RequestScopeOptions<T> {
	/** Opens the resource of one request. */
	create: () => Promise<ScopedHandle<T>>;
	/** Keeps the runtime alive until the promise settles, like `ctx.waitUntil` on Workers. */
	waitUntil: (promise: Promise<unknown>) => Promise<void> | void;
}

interface RequestScope<T> {
	/** Returns the resource of the request, opened on first use and shared by later calls. Throws after `release`. */
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
	const released = new WeakSet<object>();

	return {
		async get(request) {
			// A reopened resource would never be ended: fail loudly instead of leaking it.
			if (released.has(request)) throw new Error('The request has ended, its resource is closed.');
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
			released.add(request);
			try {
				const { end } = await handle;
				await options.waitUntil(end());
			} catch {
				// Opening failed, so there is nothing to end; the caller of `get` saw the error.
			}
		},
	};
}

function ignore(): void {
	// `done` swallows release failures, so this never runs.
}

/**
 * Copies the own properties of one response to another, where TanStack Start keeps its markers.
 * Properties the target has itself (a runtime's fields of every Response) stay as they are.
 *
 * @param source The original response.
 * @param target The response that replaces it.
 * @returns The target.
 */
function withOwnPropertiesOf(source: Response, target: Response): Response {
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor !== undefined && !Object.hasOwn(target, key)) {
			Object.defineProperty(target, key, descriptor);
		}
	}
	return target;
}

/**
 * Runs `release` once the body of the response is done: fully read, cancelled or failed. A
 * response without a body releases at once. Releasing when the response is produced would end
 * the resource while a streamed body may still need it.
 *
 * A response without a body comes back as the same object: TanStack Start recognizes a redirect
 * by the `options` on it and resolves its target only then. A response with a body comes back as
 * a new `Response` with the same status, status text and headers and with the own properties of
 * the original, which is where Start keeps its markers (such as the transport headers of a
 * server function's reply).
 *
 * @param response The response to wrap.
 * @param release Called exactly once.
 * @returns The response itself, or one with the same status, headers and markers.
 */
function releaseWhenBodyDone(response: Response, release: () => Promise<void> | void): Response {
	const source = response.body;
	let called = false;
	const done = async (): Promise<void> => {
		if (called) return;
		called = true;
		try {
			await release();
		} catch {
			// The release handles its own failures, nothing to add for the response.
		}
	};
	if (source === null) {
		// oxlint-disable-next-line promise/prefer-await-to-then -- `done` never rejects, the response is returned synchronously
		done().catch(ignore);
		return response;
	}
	const reader = source.getReader();
	const body = new ReadableStream<Uint8Array>({
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} finally {
				await done();
			}
		},
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (chunk.done) {
					controller.close();
					await done();
				} else {
					controller.enqueue(chunk.value);
				}
			} catch (error) {
				controller.error(error);
				await done();
			}
		},
	});
	return withOwnPropertiesOf(response, new Response(body, response));
}

export { createRequestScope, releaseWhenBodyDone };
export type { RequestScope, RequestScopeOptions, ScopedHandle };
