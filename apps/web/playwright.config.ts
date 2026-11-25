import { defineConfig, devices } from '@playwright/test';

import { E2E_SERVER_ENV, E2E_URL } from './e2e/env';

// oxlint-disable-next-line node/no-process-env -- CI sets `CI`, the only switch of this config
const isCi = process.env.CI !== undefined;

/**
 * End-to-end tests against the Node build, with PostgreSQL and Mailpit from
 * `docker/compose.dev.yml` (in CI: the job's service containers). The server is built and started
 * for every run, so it never runs with other settings than `E2E_SERVER_ENV`. The tests share one
 * database and run in order, in one worker.
 */
export default defineConfig({
	forbidOnly: isCi,
	fullyParallel: false,
	globalSetup: './e2e/global-setup.ts',
	// One project per flow. `contacts` and `design` need the club that `fundament` sets up, so they run after it.
	projects: [
		{ name: 'fundament', testMatch: 'fundament.e2e.ts', use: { ...devices['Desktop Chrome'] } },
		{
			dependencies: ['fundament'],
			name: 'contacts',
			testMatch: 'contacts.e2e.ts',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			dependencies: ['fundament'],
			name: 'design',
			testMatch: 'design.e2e.ts',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	reporter: isCi ? [['github'], ['list']] : 'list',
	testDir: './e2e',
	use: {
		baseURL: E2E_URL,
		// What the reverse proxy in front of a Node server sets (README); without it, Better Auth
		// rate limits all clients in one bucket and warns about it.
		extraHTTPHeaders: { 'x-forwarded-for': '127.0.0.1' },
		locale: 'de-DE',
		trace: 'retain-on-failure',
	},
	webServer: {
		command: 'vp run build:node && node dist/node/server/index.mjs',
		env: E2E_SERVER_ENV,
		reuseExistingServer: false,
		// The command builds first; a cold CI runner needs more than the default minute.
		timeout: 180_000,
		// The server answers once it has migrated the database and reaches it.
		url: `${E2E_URL}/api/health`,
	},
	workers: 1,
});
