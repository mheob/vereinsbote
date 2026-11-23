import { createDb } from './client';
import { runMigrations } from './migrate';

// oxlint-disable-next-line node/no-process-env -- standalone script, runs outside the app's env parsing
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === '') {
	throw new Error('DATABASE_URL is not set.');
}

// oxlint-disable-next-line node/no-top-level-await -- tsx runs this file as an ES module script
const db = await createDb(databaseUrl, 'pg');
// oxlint-disable-next-line node/no-top-level-await -- see above
await runMigrations(db);
// oxlint-disable-next-line no-console -- CLI output
console.log('Migrations applied.');
// The pg pool keeps the event loop alive, and the script has nothing left to do.
// oxlint-disable-next-line unicorn/no-process-exit -- see above
process.exit(0);
