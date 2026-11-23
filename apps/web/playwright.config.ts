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
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	reporter: isCi ? [['github'], ['list']] : 'list',
	testDir: './e2e',
	testMatch: '**/*.e2e.ts',
	use: { baseURL: E2E_URL, locale: 'de-DE', trace: 'retain-on-failure' },
	webServer: {
		command: 'vp run build:node && node dist/node/server/index.mjs',
		env: E2E_SERVER_ENV,
		reuseExistingServer: false,
		// The server answers once it has migrated the database and reaches it.
		url: `${E2E_URL}/api/health`,
	},
	workers: 1,
});
