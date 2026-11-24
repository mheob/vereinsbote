import { runVercelMigrationStep } from './vercel-migrations';

/*
 * The migration step of the Vercel build (`apps/web/vercel.json`): migrates in production builds
 * and, with `MIGRATE_ON_PREVIEW=1`, in preview builds; fails a Vercel build without a known
 * `VERCEL_ENV` (see `vercelMigrationStep`).
 */

// oxlint-disable-next-line node/no-top-level-await -- tsx runs this file as an ES module script
process.exitCode = await runVercelMigrationStep(
	// oxlint-disable-next-line node/no-process-env -- standalone script, runs outside the app's env parsing
	process.env,
	{
		/* oxlint-disable no-console -- CLI output */
		error: (message) => {
			console.error(message);
		},
		log: (message) => {
			console.log(message);
		},
		/* oxlint-enable no-console */
		async migrate() {
			await import('./migrate-cli');
		},
	},
);
