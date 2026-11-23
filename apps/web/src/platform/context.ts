import { createDb } from '../server/db/client';
import type { Db } from '../server/db/client';
import { parseEnv } from '../server/env';
import type { Env } from '../server/env';

type PlatformName = 'cloudflare' | 'node' | 'vercel';

interface AppContext {
	env: Env;
	db: Db;
}

/**
 * The platform of this build. Under `vp dev` the build constant is unset, and a dev server runs
 * on Node, so an unset platform behaves like `node`.
 *
 * @returns The platform name.
 */
function currentPlatform(): PlatformName {
	return import.meta.env.VITE_VB_PLATFORM ?? 'node';
}

interface CloudflareWorkers {
	env: Readonly<Record<string, string | undefined>>;
}

async function readEnvSource(
	platform: PlatformName,
): Promise<Readonly<Record<string, string | undefined>>> {
	if (platform === 'cloudflare') {
		// Only the Workers runtime has this module. The specifier is kept out of the bundler's sight,
		// the Node and Vercel builds could not resolve it.
		const specifier = 'cloudflare:workers';
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Workers runtime defines this module's shape
		const { env } = (await import(/* @vite-ignore */ specifier)) as CloudflareWorkers;
		return env;
	}
	// oxlint-disable-next-line node/no-process-env -- Node and Vercel hand their settings over here.
	return process.env;
}

async function createContext(): Promise<AppContext> {
	const platform = currentPlatform();
	const env = parseEnv({ ...(await readEnvSource(platform)) });
	const db = await createDb(env.databaseUrl, platform === 'node' ? 'pg' : 'neon');
	return { db, env };
}

const cache: { promise?: Promise<AppContext> } = {};

async function createCachedContext(): Promise<AppContext> {
	try {
		return await createContext();
	} catch (error) {
		// Do not keep a failed attempt, the next call retries.
		cache.promise = undefined;
		throw error;
	}
}

/**
 * Returns the app context, created once per isolate.
 *
 * @returns The validated environment and the database client.
 */
async function getAppContext(): Promise<AppContext> {
	cache.promise ??= createCachedContext();
	return cache.promise;
}

export { getAppContext };
export type { AppContext, PlatformName };
