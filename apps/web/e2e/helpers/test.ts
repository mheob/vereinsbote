import { expect as baseExpect, test as base } from '@playwright/test';

/** What the browser reports for a request the Content Security Policy blocked. */
type CspViolation = Readonly<{
	blockedURI: string;
	disposition: string;
	effectiveDirective: string;
	sourceFile: string;
}>;

/** The name of the function the fixture gives every page; the page calls it per violation. */
const REPORT_FUNCTION = 'vbReportCspViolation';

/**
 * Playwright's `test`, plus a fixture that runs in every test (`auto`): the page reports each
 * `securitypolicyviolation` event, and the test fails at its end when there was one. So no E2E
 * flow can run into the Content Security Policy unnoticed. The report goes through a function
 * the page calls (`exposeFunction`), not through a variable of the page, so violations of
 * documents the test has left already count too.
 */
const test = base.extend<{ cspViolations: null }>({
	cspViolations: [
		async ({ page }, use) => {
			const violations: CspViolation[] = [];
			await page.exposeFunction(REPORT_FUNCTION, (violation: CspViolation) => {
				violations.push(violation);
			});
			await page.addInitScript((reportFunction) => {
				document.addEventListener('securitypolicyviolation', (event) => {
					const { blockedURI, disposition, effectiveDirective, sourceFile } = event;
					const report: unknown = Reflect.get(globalThis, reportFunction);
					if (typeof report === 'function') {
						Reflect.apply(report, globalThis, [
							{ blockedURI, disposition, effectiveDirective, sourceFile },
						]);
					}
				});
			}, REPORT_FUNCTION);
			// oxlint-disable-next-line react-hooks/rules-of-hooks -- Playwright's `use`, not a React hook
			await use(null);
			baseExpect(violations, 'Content Security Policy violations').toStrictEqual([]);
		},
		{ auto: true },
	],
});

export { expect } from '@playwright/test';
export { test };
