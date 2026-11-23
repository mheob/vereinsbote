import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, type UserConfig } from 'vite-plus';

/**
 * The server adapter of each build target, as described in the TanStack Start hosting guide.
 * Cloudflare's Worker entry (`src/platform/cloudflare-worker.ts`, with the cron trigger) is the
 * `main` of `wrangler.jsonc`, which the Cloudflare plugin reads.
 */
const platformConfigs = {
	cloudflare: (): UserConfig => ({
		build: { outDir: 'dist/cloudflare' },
		plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } })],
	}),
	node: (): UserConfig => ({
		plugins: [
			nitro({
				output: { dir: 'dist/node' },
				// Runs the tick interval from startup on (see the file).
				plugins: ['./src/platform/node-server.ts'],
				preset: 'node-server',
			}),
		],
	}),
	vercel: (): UserConfig => ({
		plugins: [
			nitro({
				preset: 'vercel',
				vercel: {
					// The tick, every 15 minutes (Spec 6.6), written to `.vercel/output/config.json`.
					config: { crons: [{ path: '/api/tick', schedule: '*/15 * * * *' }], version: 3 },
					// A tick has a 4-minute budget; 5 minutes leave room for the chain request.
					functionRules: { '/api/tick': { maxDuration: 300 } },
				},
			}),
		],
	}),
};

type Platform = keyof typeof platformConfigs;

function isPlatform(value: string): value is Platform {
	return Object.hasOwn(platformConfigs, value);
}

/**
 * Returns the adapter config of the platform in `VITE_VB_PLATFORM`. `vp dev` and `vp run` load
 * this file without a platform, so an unset platform gets no adapter.
 *
 * @param platform The value of `VITE_VB_PLATFORM`.
 * @returns The adapter config, or an empty config when no platform is set.
 */
function platformConfig(platform: string | undefined): UserConfig {
	if (platform === undefined) return {};
	if (!isPlatform(platform)) {
		const platforms = Object.keys(platformConfigs).join(', ');
		throw new Error(`VITE_VB_PLATFORM must be one of ${platforms}, got "${platform}".`);
	}
	return platformConfigs[platform]();
}

// oxlint-disable-next-line node/no-process-env -- Vitest and the build scripts pass their settings here.
const { VITE_VB_PLATFORM, VITEST } = process.env;

/** Resolves `@/` (→ `src/`) from the `paths` of `tsconfig.json`, in the app and in the tests. */
const resolve: UserConfig['resolve'] = { tsconfigPaths: true };

export default defineConfig((): UserConfig => {
	// The unit tests import plain modules, they need none of the app plugins.
	if (VITEST !== undefined) return { resolve };

	const { plugins = [], ...adapterConfig } = platformConfig(VITE_VB_PLATFORM);
	return {
		...adapterConfig,
		plugins: [...plugins, tailwindcss(), tanstackStart(), viteReact()],
		resolve,
		server: { port: 3000 },
	};
});
