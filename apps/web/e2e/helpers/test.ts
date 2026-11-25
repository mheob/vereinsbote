import { expect as baseExpect, test as base } from '@playwright/test';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

/** What the browser reports for a request the Content Security Policy blocked. */
type CspViolation = Readonly<{
	blockedURI: string;
	disposition: string;
	documentURI: string;
	effectiveDirective: string;
	sourceFile: string;
}>;

/** The name of the function every context gives its pages; a page calls it per violation. */
const REPORT_FUNCTION = 'vbReportCspViolation';
/** The name of the function every page has that waits until its reports have arrived. */
const REPORTED_FUNCTION = 'vbCspViolationsReported';

/** The violations of one worker's contexts that no test has checked yet, by watched browser. */
const pendingViolations = new WeakMap<Browser, CspViolation[]>();

/**
 * Runs in every document and frame of a watched context, before the page's own scripts. A
 * report reaches the test a moment after the page saw the violation (the binding is
 * asynchronous), so the page also gets a function that waits until its reports have arrived.
 *
 * @param names The names of the functions.
 * @param names.report The function the context exposes.
 * @param names.reported The function that waits for the reports.
 */
function reportViolations(names: Readonly<{ report: string; reported: string }>): void {
	const reports: Promise<unknown>[] = [];
	document.addEventListener('securitypolicyviolation', (event) => {
		const { blockedURI, disposition, documentURI, effectiveDirective, sourceFile } = event;
		const report: unknown = Reflect.get(globalThis, names.report);
		if (typeof report !== 'function') return;
		const violation = { blockedURI, disposition, documentURI, effectiveDirective, sourceFile };
		reports.push(Promise.resolve(Reflect.apply(report, globalThis, [violation])));
	});
	Reflect.set(globalThis, names.reported, async () => Promise.all(reports));
}

/**
 * Has every page of a context report its violations into a list. The report goes through a
 * function the page calls (`exposeBinding`), not through a variable of the page, so violations of
 * documents the test has left already count too.
 *
 * @param context The new context.
 * @param violations The list of the worker.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a context is a handle on the browser, and the list is filled on purpose
async function watch(context: BrowserContext, violations: CspViolation[]): Promise<void> {
	await context.exposeBinding(REPORT_FUNCTION, (_source, violation: CspViolation) => {
		violations.push(violation);
	});
	await context.addInitScript(reportViolations, {
		report: REPORT_FUNCTION,
		reported: REPORTED_FUNCTION,
	});
}

/**
 * The worker's browser, with every new context watched: the one of the `page` fixture and those a
 * test or a `beforeAll` opens with `browser.newContext()` or `browser.newPage()`.
 *
 * @param browser Playwright's browser.
 * @param violations The list of the worker.
 * @returns The same browser, through a proxy.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see watch
function watchedBrowser(browser: Browser, violations: CspViolation[]): Browser {
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's own options, passed on as they are
	const newContext = async (options?: BrowserContextOptions): Promise<BrowserContext> => {
		const context = await browser.newContext(options);
		await watch(context, violations);
		return context;
	};
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see newContext
	const newPage = async (options?: BrowserContextOptions): Promise<Page> => {
		const page = await browser.newPage(options);
		// The page is still blank: the script runs from its first navigation on.
		await watch(page.context(), violations);
		return page;
	};
	return new Proxy(browser, {
		get(target, property) {
			if (property === 'newContext') return newContext;
			if (property === 'newPage') return newPage;
			const value: unknown = Reflect.get(target, property, target);
			if (typeof value !== 'function') return value;
			// Playwright's own methods expect the real browser as `this`.
			const method: unknown = value.bind(target);
			return method;
		},
	});
}

/**
 * The violations since the last check, taken out of the list.
 *
 * @param browser The watched browser.
 * @returns The violations.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a browser is a handle, used as a key only
function takeViolations(browser: Browser): CspViolation[] {
	return pendingViolations.get(browser)?.splice(0) ?? [];
}

/**
 * Playwright's `test`, plus a CSP watch over every browser context of the worker: each page
 * reports its `securitypolicyviolation` events, and a fixture that runs in every test (`auto`)
 * fails the test at its end when there was one since the last test. So no E2E flow can run into
 * the Content Security Policy unnoticed, also not on a page a `beforeAll` opened and the serial
 * tests share: a violation there fails the test during which it happened (one in `beforeAll`
 * fails the first test, one after the last test the worker's teardown).
 */
const test = base.extend<{ cspViolations: null }>({
	browser: [
		async ({ browser }, use) => {
			const violations: CspViolation[] = [];
			const watched = watchedBrowser(browser, violations);
			pendingViolations.set(watched, violations);
			// oxlint-disable-next-line react-hooks/rules-of-hooks -- Playwright's `use`, not a React hook
			await use(watched);
			baseExpect(
				violations,
				'Content Security Policy violations after the last test',
			).toStrictEqual([]);
		},
		{ scope: 'worker' },
	],
	cspViolations: [
		async ({ browser }, use) => {
			// oxlint-disable-next-line react-hooks/rules-of-hooks -- Playwright's `use`, not a React hook
			await use(null);
			baseExpect(takeViolations(browser), 'Content Security Policy violations').toStrictEqual([]);
		},
		{ auto: true },
	],
});

/**
 * Waits until the violations the main frame of a page has seen are in the watch's list. A test
 * that provokes a violation on purpose waits for it here: the report travels through a binding
 * and may arrive after the test has gone on, or never, when the test closes the page first.
 *
 * @param page The page.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function cspViolationsReported(page: Page): Promise<void> {
	await page.evaluate(async (name) => {
		const reported: unknown = Reflect.get(globalThis, name);
		if (typeof reported === 'function') await Reflect.apply(reported, globalThis, []);
	}, REPORTED_FUNCTION);
}

export { expect } from '@playwright/test';
export { cspViolationsReported, test };
