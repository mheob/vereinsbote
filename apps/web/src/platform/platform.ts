/** The deploy target, the build constant `VITE_VB_PLATFORM`; `vp dev` runs on Node. */
type PlatformName = 'cloudflare' | 'node' | 'vercel';

/** What differs between the deploy targets for work that outlives a response. */
interface Platform {
	readonly name: PlatformName;
	/** Keeps the runtime alive until the promise settles (Workers' and Vercel's `waitUntil`). */
	readonly waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * The platform of this build, a constant the bundler inlines.
 *
 * @returns The build's platform, `node` under `vp dev` (a dev server runs on Node).
 */
function platformName(): PlatformName {
	return import.meta.env.VITE_VB_PLATFORM ?? 'node';
}

export { platformName };
export type { Platform, PlatformName };
