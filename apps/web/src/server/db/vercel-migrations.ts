type EnvSource = Readonly<Record<string, string | undefined>>;

/** What the migration step of a Vercel build does. */
type VercelMigrationStep = 'migrate' | 'refuse' | 'skip';

/** The values Vercel sets in `VERCEL_ENV`. */
const KNOWN_VERCEL_ENVS: ReadonlySet<string> = new Set(['development', 'preview', 'production']);

/**
 * Whether a Vercel build applies the migrations. A production build does. A preview or
 * development build does only with `MIGRATE_ON_PREVIEW=1`: by default its `DATABASE_URL` may be
 * the production database, and every push would run unreviewed migrations against it. Set the
 * flag only where Preview has a database of its own, such as a Neon branch.
 *
 * A build on Vercel (`VERCEL=1`) without a known `VERCEL_ENV` is refused: it cannot tell a
 * production build from a preview, and skipping would leave production on the old schema without
 * a trace. Outside Vercel the rules above apply as they are.
 *
 * @param env The build's environment (`VERCEL` and `VERCEL_ENV` are set by Vercel).
 * @returns `migrate`, `skip`, or `refuse` for an unknown environment on Vercel.
 */
function vercelMigrationStep(env: EnvSource): VercelMigrationStep {
	const vercelEnv = env.VERCEL_ENV;
	if (env.VERCEL === '1' && (vercelEnv === undefined || !KNOWN_VERCEL_ENVS.has(vercelEnv))) {
		return 'refuse';
	}
	if (vercelEnv === 'production' || env.MIGRATE_ON_PREVIEW === '1') return 'migrate';
	return 'skip';
}

interface VercelMigrationDeps {
	/** Applies the pending migrations. */
	readonly migrate: () => Promise<void>;
	readonly log: (message: string) => void;
	readonly error: (message: string) => void;
}

/**
 * The migration step of the Vercel build (`apps/web/vercel.json`), see `vercelMigrationStep`. Its
 * messages name variables, never their values.
 *
 * @param env The build's environment.
 * @param deps How to migrate and where the messages go.
 * @returns The exit code: 0 when migrated or skipped, 1 when refused.
 */
async function runVercelMigrationStep(env: EnvSource, deps: VercelMigrationDeps): Promise<number> {
	const step = vercelMigrationStep(env);
	if (step === 'migrate') {
		await deps.migrate();
		return 0;
	}
	if (step === 'skip') {
		deps.log(
			'Migrations skipped: not a production build (MIGRATE_ON_PREVIEW=1 migrates a preview).',
		);
		return 0;
	}
	deps.error(
		'Migrations not run: this Vercel build has no known VERCEL_ENV (production, preview or ' +
			'development), so it cannot tell production from a preview. Enable "Automatically expose ' +
			'System Environment Variables" in the project settings.',
	);
	return 1;
}

export { runVercelMigrationStep, vercelMigrationStep };
export type { VercelMigrationDeps, VercelMigrationStep };
