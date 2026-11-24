/** Build constant set by the `build:*` scripts, see `vite.config.ts`. Unset under `vp dev`. */
interface ImportMetaEnv {
	readonly VITE_VB_PLATFORM?: 'cloudflare' | 'node' | 'vercel';
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
