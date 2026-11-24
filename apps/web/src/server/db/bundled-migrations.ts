import { z } from 'zod';

import type { Migration } from './apply-migrations';

/*
 * The migrations of `apps/web/drizzle`, built into the bundle, so the Node server can apply them
 * at startup: its output has no `drizzle` folder, and where the bundler puts a module is not
 * fixed, so a path relative to the module would not hold. The result equals Drizzle's
 * `readMigrationFiles` (see the test); it needs neither `node:fs` nor `node:crypto`.
 */

const JOURNAL_PATH = '/drizzle/meta/_journal.json';
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
const HEX_RADIX = 16;

const journalEntry = z.object({ breakpoints: z.boolean(), tag: z.string(), when: z.number() });
const journalSchema = z.object({ entries: z.array(journalEntry) });

// Vite inlines the files as text at build time; the keys are paths from the app's root.
const files = import.meta.glob<string>(['/drizzle/*.sql', '/drizzle/meta/_journal.json'], {
	eager: true,
	import: 'default',
	query: '?raw',
});

/**
 * The text of a bundled file.
 *
 * @param path The path from the app's root, e.g. `/drizzle/0000_name.sql`.
 * @returns The file's text.
 */
function bundledFile(path: string): string {
	const text = files[path];
	if (text === undefined) throw new Error(`${path} is not in the bundle.`);
	return text;
}

/**
 * The SHA-256 of a text, as Drizzle records it for each migration.
 *
 * @param text The text.
 * @returns The hash in lowercase hex.
 */
async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	const bytes = new Uint8Array(digest);
	return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(2, '0')).join('');
}

/**
 * All migrations in the order of Drizzle's journal, oldest first.
 *
 * @returns The migrations, ready for `applyMigrations`.
 */
async function bundledMigrations(): Promise<Migration[]> {
	const journal: unknown = JSON.parse(bundledFile(JOURNAL_PATH));
	const { entries } = journalSchema.parse(journal);
	return Promise.all(
		entries.map(async ({ breakpoints, tag, when }) => {
			const query = bundledFile(`/drizzle/${tag}.sql`);
			return {
				bps: breakpoints,
				folderMillis: when,
				hash: await sha256Hex(query),
				sql: query.split(STATEMENT_BREAKPOINT),
			};
		}),
	);
}

export { bundledMigrations };
