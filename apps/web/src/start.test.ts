import { AsyncLocalStorage } from 'node:async_hooks';

import { notFound, redirect } from '@tanstack/react-router';
import { createMiddleware, createServerFn } from '@tanstack/react-start';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { ServerFunctionError } from '@/platform/server-fn-errors';

import { startInstance } from './start';

/**
 * Runs a function in a request context of TanStack Start. Start keeps that context in an
 * AsyncLocalStorage (`runWithStartContext` of `@tanstack/start-storage-context`, which the app
 * does not depend on directly); server functions read the start options, and with them the global
 * function middleware, from there.
 *
 * @param context The request context.
 * @param run What runs inside it.
 * @returns What `run` returns.
 */
async function inStartContext<T>(context: object, run: () => Promise<T>): Promise<T> {
	const storage: unknown = Reflect.get(
		globalThis,
		Symbol.for('tanstack-start:start-storage-context'),
	);
	if (!(storage instanceof AsyncLocalStorage))
		throw new TypeError('TanStack Start has no storage.');
	return storage.run(context, run);
}

/**
 * Runs a server function whose own middleware throws, the way Start's server runs it for a
 * request: through the global function middleware of `startInstance`, then the function's own.
 *
 * @param thrown What the server function throws.
 * @returns The error the server function hands to Start's response.
 */
async function runFailingServerFn(thrown: unknown): Promise<unknown> {
	const failing = createMiddleware({ type: 'function' }).server(() => {
		// oxlint-disable-next-line typescript/only-throw-error -- redirects and not-found results are thrown too
		throw thrown;
	});
	const serverFn = createServerFn({ method: 'POST' })
		.middleware([failing])
		.handler(() => null);
	const context = {
		executedRequestMiddlewares: new Set(),
		handlerType: 'serverFn',
		request: new Request('https://bote.example.org/_serverFn/test', { method: 'POST' }),
		startOptions: await startInstance.getOptions(),
	};
	const outcome = await inStartContext(context, async () =>
		// oxlint-disable-next-line no-underscore-dangle -- what Start's server calls for a request
		serverFn.__executeServer({ data: undefined, method: 'POST' }),
	);
	if (typeof outcome !== 'object' || outcome === null || !('error' in outcome)) {
		throw new TypeError('The server function did not fail.');
	}
	return outcome.error;
}

describe('the function middleware of the app', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('sends an unexpected error of a server function only as ServerFunctionError', async () => {
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		const error = await runFailingServerFn(
			new Error('Failed query: select * from "user"\nparams: anna@verein.de'),
		);
		expect(error).toBeInstanceOf(ServerFunctionError);
		expect(JSON.stringify(logged.mock.calls)).not.toContain('anna@verein.de');
	});

	it('passes a redirect on', async () => {
		const toLogin = redirect({ to: '/login' });
		await expect(runFailingServerFn(toLogin)).resolves.toBe(toLogin);
	});

	it('passes a not-found result on', async () => {
		const missing = notFound();
		await expect(runFailingServerFn(missing)).resolves.toBe(missing);
	});
});
