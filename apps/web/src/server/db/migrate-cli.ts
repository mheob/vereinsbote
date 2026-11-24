import { runMigrations } from './migrate';
import { openPgDb } from './pg-client';

// oxlint-disable-next-line node/no-process-env -- standalone script, runs outside the app's env parsing
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === '') {
	throw new Error('DATABASE_URL is not set.');
}

const { db, end } = openPgDb(databaseUrl);
// oxlint-disable-next-line node/no-top-level-await -- tsx runs this file as an ES module script
await runMigrations(db);
// oxlint-disable-next-line node/no-top-level-await -- see above
await end();
// oxlint-disable-next-line no-console -- CLI output
console.log('Migrations applied.');
