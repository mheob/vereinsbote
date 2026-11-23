import { getRequest } from '@tanstack/react-start/server';

import { createAuth } from '@/server/auth/auth';
import type { Auth, BackgroundRunner } from '@/server/auth/auth';
import { openDb } from '@/server/db/client';
import type { Db, DbHandle } from '@/server/db/client';
import { parseEnv } from '@/server/env';
import type { Env } from '@/server/env';
import { createSystemMailer } from '@/server/mail/system-mailer';
import type { SystemMailer } from '@/server/mail/system-mailer';

import { createRequestScope } from './request-scope';

type PlatformName = 'cloudflare' | 'node' | 'vercel';

interface AppContext {
	env: Env;
	db: Db;
	/** Bound to `db`, so on Cloudflare it lives as long as the request's database. */
	auth: Auth;
	/** Stateless, shared by all requests of an isolate. */
	mailer: SystemMailer;
}

/** What all requests of an isolate share: the environment, the stateless mailer and the runner. */
interface IsolateServices {
	env: Env;
	mailer: SystemMailer;
	/** Keeps work (sending a login link) alive after the response. */
	runInBackground: BackgroundRunner;
}

/** A database and the auth instance bound to it; on Cloudflare, what one request owns. */
interface DbServices {
	db: Db;
	auth: Auth;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

interface CloudflareWorkers {
	env: EnvSource;
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
	waitUntil: (promise: Promise<unknown>) => void;
}

/*
 * The platform is the build constant `import.meta.env.VITE_VB_PLATFORM`. Under `vp dev` it is
 * unset, and a dev server runs on Node, so an unset platform behaves like `node`. The constant is
 * compared inline so the bundler removes the branches of the other platforms.
 */

/**
 * Node and Vercel hand their settings over in `process.env`.
 *
 * @returns The environment variables.
 */
function readProcessEnv(): EnvSource {
	// oxlint-disable-next-line node/no-process-env -- the platform provides its settings here.
	return process.env;
}

/**
 * Workers pass their settings to `cloudflare:workers`, a module only that runtime has.
 *
 * @returns The runtime's `env` and `waitUntil`.
 */
async function loadWorkers(): Promise<CloudflareWorkers> {
	// The specifier is kept out of the bundler's sight, the Node and Vercel builds could not resolve it.
	const specifier = 'cloudflare:workers';
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Workers runtime defines this module's shape
	return import(/* @vite-ignore */ specifier) as Promise<CloudflareWorkers>;
}

/**
 * The request being handled.
 *
 * @returns The request, or null outside a request.
 */
function currentRequest(): Request | null {
	try {
		return getRequest();
	} catch {
		return null;
	}
}

interface WaitUntilRequest {
	waitUntil: BackgroundRunner;
}

function hasWaitUntil(request: object): request is WaitUntilRequest {
	return 'waitUntil' in request && typeof request.waitUntil === 'function';
}

/**
 * Node and Vercel: hands the promise to the runtime's `waitUntil`, which Nitro puts on the
 * request (Vercel's function context; srvx on Node). Without one the promise simply runs on,
 * which a Node process allows.
 *
 * @param promise The work to finish after the response.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
function runAfterResponse(promise: Promise<unknown>): void {
	const request = currentRequest();
	if (request !== null && hasWaitUntil(request)) request.waitUntil(promise);
}

/**
 * Creates the auth instance for an opened database. Ends the database when that fails, so a
 * failed attempt leaves no pool behind.
 *
 * @param isolate The environment, the mailer and the background runner.
 * @param isolate.env The environment.
 * @param isolate.mailer The mailer.
 * @param isolate.runInBackground Keeps the sending of login links alive after the response.
 * @param handle The opened database.
 * @param handle.db The database client.
 * @param handle.end Closes the database.
 * @returns The database and its auth instance.
 */
async function bindAuth(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Env holds a URL and a Uint8Array, which cannot be readonly
	{ env, mailer, runInBackground }: Readonly<IsolateServices>,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle clients are mutable class instances
	{ db, end }: Readonly<DbHandle>,
): Promise<DbServices> {
	try {
		return { auth: await createAuth({ db, env, mailer, runInBackground }), db };
	} catch (error) {
		await end();
		throw error;
	}
}

/** One context per isolate: Node and Vercel can share their pool across requests. */
const cache: { promise?: Promise<AppContext> } = {};

async function createSharedContext(): Promise<AppContext> {
	try {
		const env = parseEnv({ ...readProcessEnv() });
		const mailer = createSystemMailer(env);
		const isolate = { env, mailer, runInBackground: runAfterResponse };
		const driver = import.meta.env.VITE_VB_PLATFORM === 'vercel' ? 'neon' : 'pg';
		const { auth, db } = await bindAuth(isolate, await openDb(env.databaseUrl, driver));
		return { auth, db, env, mailer };
	} catch (error) {
		// Do not keep a failed attempt, the next call retries.
		cache.promise = undefined;
		throw error;
	}
}

/*
 * Cloudflare: env, mailer and the `waitUntil` runner are cached per isolate, the database is
 * not. A Neon pool holds WebSockets, which belong to the request that opened them, so each
 * request gets its own pool, which `requestDbReleaser` ends via `waitUntil` once the response is
 * done. The auth instance holds that pool, so it is created per request as well.
 */
const cloudflare: { isolate?: Promise<IsolateServices> } = {};

async function createIsolateServices(): Promise<IsolateServices> {
	try {
		const workers = await loadWorkers();
		const env = parseEnv({ ...workers.env });
		return {
			env,
			mailer: createSystemMailer(env),
			// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
			runInBackground(promise) {
				workers.waitUntil(promise);
			},
		};
	} catch (error) {
		cloudflare.isolate = undefined;
		throw error;
	}
}

const requestServices = createRequestScope<DbServices>({
	async create() {
		cloudflare.isolate ??= createIsolateServices();
		const isolate = await cloudflare.isolate;
		const handle = await openDb(isolate.env.databaseUrl, 'neon');
		return { end: handle.end, value: await bindAuth(isolate, handle) };
	},
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
	async waitUntil(promise) {
		const workers = await loadWorkers();
		workers.waitUntil(promise);
	},
});

async function getCloudflareContext(): Promise<AppContext> {
	cloudflare.isolate ??= createIsolateServices();
	const [{ env, mailer }, { auth, db }] = await Promise.all([
		cloudflare.isolate,
		requestServices.get(getRequest()),
	]);
	return { auth, db, env, mailer };
}

/**
 * Returns the app context. On Node and Vercel it is created once per isolate. On Cloudflare the
 * database and the auth instance are created once per request, and calls within one request
 * share them.
 *
 * @returns The validated environment, the database client, the auth instance and the mailer.
 */
async function getAppContext(): Promise<AppContext> {
	if (import.meta.env.VITE_VB_PLATFORM === 'cloudflare') return getCloudflareContext();
	cache.promise ??= createSharedContext();
	return cache.promise;
}

/**
 * Binds the end of the current request's database to a function the request middleware calls
 * once the response body is done (the request is looked up now, the body finishes outside the
 * request context).
 *
 * @returns The release function, or null outside Cloudflare, where the database is shared.
 */
function requestDbReleaser(): (() => Promise<void>) | null {
	if (import.meta.env.VITE_VB_PLATFORM !== 'cloudflare') return null;
	const request = getRequest();
	return async () => {
		await requestServices.release(request);
	};
}

export { getAppContext, requestDbReleaser };
export type { AppContext, PlatformName };
