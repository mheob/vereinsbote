import { SECURITY_HEADERS } from './security-headers';

/*
 * The built assets (`/assets/…`, the scripts and styles of the pages) are served without the app:
 * by Nitro's static handler (Node), Vercel's CDN and Cloudflare's Workers assets. Start's request
 * middleware never sees them, so each platform's own configuration gives them `SECURITY_HEADERS`.
 * The build reads these values (`apps/web/vite.config.ts`).
 */

/** Nitro's route rule for the built assets; the Vercel preset writes it into its `config.json`. */
const STATIC_ASSET_ROUTE_RULES = {
	'/assets/**': { headers: { ...SECURITY_HEADERS } },
} as const;

/**
 * The `_headers` file of the Workers assets (Cloudflare), in the format Cloudflare documents for
 * static assets: a path pattern, then one indented `name: value` line per header.
 *
 * @returns The content of `_headers`.
 */
function workersAssetHeadersFile(): string {
	const lines = Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`);
	return ['/assets/*', ...lines, ''].join('\n');
}

export { STATIC_ASSET_ROUTE_RULES, workersAssetHeadersFile };
