import path from 'node:path';

import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

import { signIn } from './sign-in';

/** The admin the project `fundament` sets up. */
const ADMIN_EMAIL = 'admin@verein.test';

/** Where a test's project keeps its output; all projects share the config's folder. */
type ProjectInfo = Readonly<{ project: Readonly<{ outputDir: string }> }>;

/**
 * The file with the admin's signed-in browser state. It lies in Playwright's output folder,
 * which Playwright empties at the start of every run, so a session never outlives its run.
 *
 * @param info The test's or the worker's info.
 * @returns The path of the file.
 */
function adminStatePath(info: ProjectInfo): string {
	return path.join(info.project.outputDir, 'admin-session.json');
}

/**
 * Signs the admin in through a sign-in link and saves the session for the later projects. The
 * server sends one sign-in link per address and minute, so the projects that run after
 * `fundament` share this one session instead of asking for links of their own.
 *
 * @param page A page of a context of its own.
 * @param info The test's info.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function saveAdminSession(page: Page, info: ProjectInfo): Promise<void> {
	await signIn(page, ADMIN_EMAIL);
	await page.context().storageState({ path: adminStatePath(info) });
}

/**
 * A new context in which the admin is signed in, with the session `fundament` saved.
 *
 * @param browser The worker's browser (watched for CSP violations by `helpers/test.ts`).
 * @param info The test's or the worker's info.
 * @param options The language and time zone of the context, if not the config's.
 * @returns The context.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see saveAdminSession
async function newAdminContext(
	browser: Browser,
	info: ProjectInfo,
	options: Readonly<Pick<BrowserContextOptions, 'locale' | 'timezoneId'>> = {},
): Promise<BrowserContext> {
	return browser.newContext({ ...options, storageState: adminStatePath(info) });
}

export { newAdminContext, saveAdminSession };
