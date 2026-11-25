import { getRequest } from '@tanstack/react-start/server';

import { createAuth } from '@/server/auth/auth';
import type { Auth } from '@/server/auth/auth';
import { openDb } from '@/server/db/client';
import type { Db, DbHandle } from '@/server/db/client';
import { parseEnv } from '@/server/env';
import type { Env } from '@/server/env';
import { createSystemMailer } from '@/server/mail/system-mailer';
import type { SystemMailer } from '@/server/mail/system-mailer';
import { openStorage } from '@/server/storage/open-storage';
import type { ObjectStorage } from '@/server/storage/storage';

import { createBackgroundRunner } from './background';
import { variablesOf } from './bindings';
import type { Bindings } from './bindings';
import { platformName } from './platform';
import type { Platform } from './platform';
import { createRequestScope } from './request-scope';

interface AppContext {
	env: Env;
	db: Db;
	/** Bound to `db`, so on Cloudflare it lives as long as the request's database. */
	auth: Auth;
	/** Stateless, shared by all requests of an isolate. */
	mailer: SystemMailer;
	/** Private storage for images, shared by all requests of an isolate; null when not set up. */
	storage: ObjectStorage | null;
	/** Keeps work (a login link, the next tick) alive after the response. */
	platform: Platform;
}

/**
 * What all requests of an isolate share: the environment, the stateless mailer, the storage, the
 * platform. The R2 binding belongs to the isolate's `env`, not to a request, so it may live here.
 */
interface IsolateServices {
	env: Env;
	mailer: SystemMailer;
	storage: ObjectStorage | null;
	platform: Platform;
}

/** A database and the auth instance bound to it; on Cloudflare, what one request owns. */
interface DbServices {
	db: Db;
	auth: Auth;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

interface CloudflareWorkers {
	/** Strings (variables, secrets) and objects (the R2 bucket). */
	env: Bindings;
	/** Missing in runtimes before `waitUntil` was exported (`createBackgroundRunner` warns then). */
	waitUntil?: (promise: Promise<unknown>) => void;
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
	waitUntil: Platform['waitUntil'];
}

function hasWaitUntil(request: object): request is WaitUntilRequest {
	return 'waitUntil' in request && typeof request.waitUntil === 'function';
}

/**
 * Node and Vercel: the runtime's `waitUntil`, which Nitro puts on the request (Vercel's function
 * context; srvx on Node). See `createBackgroundRunner` for what happens without one.
 *
 * @returns The `waitUntil` of the current request, or null.
 */
function requestWaitUntil(): Platform['waitUntil'] | null {
	const request = currentRequest();
	if (request === null || !hasWaitUntil(request)) return null;
	return (promise) => {
		request.waitUntil(promise);
	};
}

const runAfterResponse = createBackgroundRunner(platformName(), requestWaitUntil);

/**
 * Creates the auth instance for an opened database. Ends the database when that fails, so a
 * failed attempt leaves no pool behind.
 *
 * @param isolate The environment, the mailer and the platform.
 * @param isolate.env The environment.
 * @param isolate.mailer The mailer.
 * @param isolate.platform Keeps the sending of login links alive after the response.
 * @param handle The opened database.
 * @param handle.db The database client.
 * @param handle.end Closes the database.
 * @returns The database and its auth instance.
 */
async function bindAuth(
	{ env, mailer, platform }: IsolateServices,
	{ db, end }: Readonly<DbHandle>,
): Promise<DbServices> {
	try {
		const runInBackground = platform.waitUntil;
		return { auth: await createAuth({ db, env, mailer, runInBackground }), db };
	} catch (error) {
		await end();
		throw error;
	}
}

/**
 * Opens the app's database with the driver of the platform.
 *
 * @param env The environment: `DATABASE_URL` and, in development, `DEV_NEON_WS_PROXY`.
 * @param driver `neon` (Vercel, Cloudflare) or `pg` (Node).
 * @returns The database and the function that closes it.
 */
async function openAppDb(env: Env, driver: 'neon' | 'pg'): Promise<DbHandle> {
	return openDb(env.databaseUrl, driver, { devNeonWsProxy: env.devNeonWsProxy });
}

/** One context per isolate: Node and Vercel can share their pool across requests. */
const cache: { promise?: Promise<AppContext> } = {};

async function createSharedContext(): Promise<AppContext> {
	try {
		const env = parseEnv({ ...readProcessEnv() });
		const mailer = createSystemMailer(env);
		const storage = await openStorage(env, null);
		const platform: Platform = { name: platformName(), waitUntil: runAfterResponse };
		const driver = import.meta.env.VITE_VB_PLATFORM === 'vercel' ? 'neon' : 'pg';
		const { auth, db } = await bindAuth(
			{ env, mailer, platform, storage },
			await openAppDb(env, driver),
		);
		return { auth, db, env, mailer, platform, storage };
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
		// Only the string bindings go to `parseEnv`; the R2 bucket goes to the storage.
		const env = parseEnv(variablesOf(workers.env));
		const waitUntil = createBackgroundRunner('cloudflare', () => workers.waitUntil ?? null);
		return {
			env,
			mailer: createSystemMailer(env),
			platform: { name: 'cloudflare', waitUntil },
			storage: await openStorage(env, workers.env),
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
		const handle = await openAppDb(isolate.env, 'neon');
		return { end: handle.end, value: await bindAuth(isolate, handle) };
	},
	async waitUntil(promise) {
		cloudflare.isolate ??= createIsolateServices();
		const { platform } = await cloudflare.isolate;
		platform.waitUntil(promise);
	},
});

async function getCloudflareContext(): Promise<AppContext> {
	cloudflare.isolate ??= createIsolateServices();
	const [{ env, mailer, platform, storage }, { auth, db }] = await Promise.all([
		cloudflare.isolate,
		requestServices.get(getRequest()),
	]);
	return { auth, db, env, mailer, platform, storage };
}

/**
 * Returns the app context. On Node and Vercel it is created once per isolate. On Cloudflare the
 * database and the auth instance are created once per request, and calls within one request
 * share them.
 *
 * @returns The validated environment, the database client, the auth instance, the mailer and the
 * storage.
 */
async function getAppContext(): Promise<AppContext> {
	if (import.meta.env.VITE_VB_PLATFORM === 'cloudflare') return getCloudflareContext();
	cache.promise ??= createSharedContext();
	return cache.promise;
}

/**
 * Returns the validated environment and the platform. Unlike `getAppContext`, it opens no
 * database on Cloudflare, so request middlewares and unauthenticated requests stay cheap.
 *
 * @returns The environment and the platform.
 */
async function getAppServices(): Promise<{ env: Env; platform: Platform }> {
	if (import.meta.env.VITE_VB_PLATFORM === 'cloudflare') {
		cloudflare.isolate ??= createIsolateServices();
		const { env, platform } = await cloudflare.isolate;
		return { env, platform };
	}
	const { env, platform } = await getAppContext();
	return { env, platform };
}

/**
 * Returns the validated environment without opening a database on Cloudflare.
 *
 * @returns The environment.
 */
async function getAppEnv(): Promise<Env> {
	const { env } = await getAppServices();
	return env;
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

export { getAppContext, getAppEnv, getAppServices, requestDbReleaser };
export type { AppContext };
export type { PlatformName } from './platform';
