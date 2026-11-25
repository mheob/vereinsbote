/*
 * The settings of the end-to-end run, shared by `playwright.config.ts`, the global setup and the
 * tests. All values are fixed test values for a local server and the services of
 * `docker/compose.dev.yml` (in CI: the job's service containers); none is a real secret.
 */

/** Not 3000, so a running `vp dev` does not get in the way. */
const E2E_PORT = 3100;

/** The app under test, also its `APP_URL`. */
const E2E_URL = `http://localhost:${E2E_PORT}`;

/** A database of its own: every run wipes it (see `global-setup.ts`). */
const E2E_DATABASE_URL = 'postgres://vereinsbote:vereinsbote@localhost:5432/vereinsbote_e2e';

/** The token the setup test types into the setup form. */
const E2E_SETUP_TOKEN = 'e2e-only-setup-token-0001';

/**
 * The environment of the app under test (see `src/server/env.ts`). Playwright adds it to the
 * shell's environment, so every variable the app reads is set here; an empty value counts as
 * unset, and a developer's own `MS_LOGIN_*`, `HEARTBEAT_URL` or `BLOB_READ_WRITE_TOKEN` cannot leak
 * into the run.
 */
const E2E_SERVER_ENV = {
	// Base64 of the 32 bytes `e2e-only-app-secret-32-bytes-xx!`.
	APP_SECRET: 'ZTJlLW9ubHktYXBwLXNlY3JldC0zMi1ieXRlcy14eCE=',
	APP_URL: E2E_URL,
	BLOB_READ_WRITE_TOKEN: '',
	CRON_SECRET: 'e2e-only-cron-secret-of-at-least-32-characters',
	DATABASE_URL: E2E_DATABASE_URL,
	DEV_NEON_WS_PROXY: '',
	// The fake mail providers of the sending e2e tests.
	DEV_PROVIDERS_URL: 'http://localhost:3200',
	DEV_SMTP_URL: 'smtp://localhost:1025',
	HEARTBEAT_URL: '',
	MS_LOGIN_CLIENT_ID: '',
	MS_LOGIN_CLIENT_SECRET: '',
	MS_LOGIN_TENANT_ID: '',
	PORT: String(E2E_PORT),
	// The SeaweedFS of docker/compose.dev.yml (in CI: the job's service container).
	S3_ACCESS_KEY_ID: 'vereinsbote',
	S3_BUCKET: 'vereinsbote',
	S3_ENDPOINT: 'http://localhost:8333',
	S3_REGION: 'us-east-1',
	S3_SECRET_ACCESS_KEY: 'vereinsbote-dev-secret',
	SETUP_TOKEN: E2E_SETUP_TOKEN,
	// The default, 15 minutes: no tick runs during the tests.
	TICK_INTERVAL_MS: '900000',
} as const;

export { E2E_DATABASE_URL, E2E_SERVER_ENV, E2E_SETUP_TOKEN, E2E_URL };
