import { migratesOnVercel } from './vercel-migrations';

/*
 * The migration step of the Vercel build (`apps/web/vercel.json`): migrates in production builds
 * and, with `MIGRATE_ON_PREVIEW=1`, in preview builds (see `migratesOnVercel`).
 */

// oxlint-disable-next-line node/no-process-env -- standalone script, runs outside the app's env parsing
if (migratesOnVercel(process.env)) {
	// oxlint-disable-next-line node/no-top-level-await -- tsx runs this file as an ES module script
	await import('./migrate-cli');
} else {
	// oxlint-disable-next-line no-console -- CLI output
	console.log(
		'Migrations skipped: not a production build (MIGRATE_ON_PREVIEW=1 migrates a preview).',
	);
}
