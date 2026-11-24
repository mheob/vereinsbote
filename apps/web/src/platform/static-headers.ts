import { BASE_SECURITY_HEADERS } from './security-headers';

/*
 * The built assets (`/assets/…`, the scripts and styles of the pages) and the social icons
 * (`/social/…`) are served without the app: by Nitro's static handler (Node), Vercel's CDN and
 * Cloudflare's Workers assets. Start's request middleware never sees them, so each platform's own
 * configuration gives them `BASE_SECURITY_HEADERS` (a static file has no nonce for a page policy).
 * The build reads these values (`apps/web/vite.config.ts`).
 */

/** The paths of the static files, as Nitro route rules write them (`**`) and Workers `_headers` (`*`). */
const STATIC_PATHS = ['/assets', '/social'] as const;

/** Nitro's route rules for the static files; the Vercel preset writes them into its `config.json`. */
const STATIC_ASSET_ROUTE_RULES = Object.fromEntries(
	STATIC_PATHS.map((path) => [`${path}/**`, { headers: { ...BASE_SECURITY_HEADERS } }]),
);

/**
 * The `_headers` file of the Workers assets (Cloudflare), in the format Cloudflare documents for
 * static assets: a path pattern, then one indented `name: value` line per header.
 *
 * @returns The content of `_headers`.
 */
function workersAssetHeadersFile(): string {
	const lines = Object.entries(BASE_SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`);
	const blocks = STATIC_PATHS.map((path) => [`${path}/*`, ...lines].join('\n'));
	return [...blocks, ''].join('\n');
}

export { STATIC_ASSET_ROUTE_RULES, workersAssetHeadersFile };
