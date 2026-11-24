import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** WCAG 2.2 AA, the level the app meets (Spec 6.9). */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * React Aria's live announcer, a visually hidden region of its own outside the app's markup. A
 * focused button that turns pending announces its label as `<div role="img" aria-labelledby>`;
 * when the button is gone before the entry expires (7 s, e.g. after the setup redirects), the
 * entry names nothing and axe reports `role-img-alt`, although it was read while the button
 * existed. The page's own live regions are checked as usual.
 */
const LIVE_ANNOUNCER = '[data-live-announcer]';

/**
 * Runs axe on the page as it is now and fails on any violation of WCAG 2.2 AA. The failure
 * lists each rule with the elements that break it.
 *
 * @param page The page to check.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function expectNoA11yViolations(page: Page): Promise<void> {
	const { violations } = await new AxeBuilder({ page })
		.withTags(WCAG_TAGS)
		.exclude(LIVE_ANNOUNCER)
		.analyze();
	const found = violations.map(({ id, nodes }) => ({
		elements: nodes.map(({ html }) => html),
		rule: id,
	}));
	expect(found, `axe violations on ${page.url()}`).toEqual([]);
}

export { expectNoA11yViolations };
