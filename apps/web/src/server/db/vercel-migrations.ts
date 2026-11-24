/**
 * Whether a Vercel build applies the migrations. A production build does. A preview or
 * development build does only with `MIGRATE_ON_PREVIEW=1`: by default its `DATABASE_URL` may be
 * the production database, and every push would run unreviewed migrations against it. Set the
 * flag only where Preview has a database of its own, such as a Neon branch.
 *
 * @param env The build's environment (`VERCEL_ENV` is set by Vercel).
 * @returns True when the build migrates.
 */
function migratesOnVercel(env: Readonly<Record<string, string | undefined>>): boolean {
	return env.VERCEL_ENV === 'production' || env.MIGRATE_ON_PREVIEW === '1';
}

export { migratesOnVercel };
