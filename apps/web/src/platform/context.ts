import { getRequest } from '@tanstack/react-start/server';

import { openDb } from '../server/db/client';
import type { Db } from '../server/db/client';
import { parseEnv } from '../server/env';
import type { Env } from '../server/env';
import { createRequestScope } from './request-scope';

type PlatformName = 'cloudflare' | 'node' | 'vercel';

interface AppContext {
	env: Env;
	db: Db;
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

/** One context per isolate: Node and Vercel can share their pool across requests. */
const cache: { promise?: Promise<AppContext> } = {};

async function createSharedContext(): Promise<AppContext> {
	try {
		const env = parseEnv({ ...readProcessEnv() });
		const driver = import.meta.env.VITE_VB_PLATFORM === 'vercel' ? 'neon' : 'pg';
		const { db } = await openDb(env.databaseUrl, driver);
		return { db, env };
	} catch (error) {
		// Do not keep a failed attempt, the next call retries.
		cache.promise = undefined;
		throw error;
	}
}

/*
 * Cloudflare: the parsed env is cached per isolate, the database is not. A Neon pool holds
 * WebSockets, which belong to the request that opened them, so each request gets its own pool,
 * which `releaseRequestDb` ends via `waitUntil` once the response is done.
 */
const cloudflare: { env?: Promise<Env> } = {};

async function parseCloudflareEnv(): Promise<Env> {
	try {
		const { env } = await loadWorkers();
		return parseEnv({ ...env });
	} catch (error) {
		cloudflare.env = undefined;
		throw error;
	}
}

const requestDb = createRequestScope<Db>({
	async create() {
		cloudflare.env ??= parseCloudflareEnv();
		const { databaseUrl } = await cloudflare.env;
		const { db, end } = await openDb(databaseUrl, 'neon');
		return { end, value: db };
	},
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
	async waitUntil(promise) {
		const workers = await loadWorkers();
		workers.waitUntil(promise);
	},
});

async function getCloudflareContext(): Promise<AppContext> {
	cloudflare.env ??= parseCloudflareEnv();
	const [env, db] = await Promise.all([cloudflare.env, requestDb.get(getRequest())]);
	return { db, env };
}

/**
 * Returns the app context. On Node and Vercel it is created once per isolate. On Cloudflare the
 * database is created once per request, and calls within one request share it.
 *
 * @returns The validated environment and the database client.
 */
async function getAppContext(): Promise<AppContext> {
	if (import.meta.env.VITE_VB_PLATFORM === 'cloudflare') return getCloudflareContext();
	cache.promise ??= createSharedContext();
	return cache.promise;
}

/**
 * Ends the database of the current request. Called by the request middleware after the response;
 * does nothing outside Cloudflare, where the database is shared.
 */
async function releaseRequestDb(): Promise<void> {
	if (import.meta.env.VITE_VB_PLATFORM !== 'cloudflare') return;
	await requestDb.release(getRequest());
}

export { getAppContext, releaseRequestDb };
export type { AppContext, PlatformName };
