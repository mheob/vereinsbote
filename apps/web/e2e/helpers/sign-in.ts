import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { latestLink } from './mailpit';

/**
 * Signs a user in through the sign-in link from Mailpit and waits for the start page. The user
 * must be invited already; the newest sign-in link to the address wins.
 *
 * @param page The page of the user's browser context.
 * @param email The user's address.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function signIn(page: Page, email: string): Promise<void> {
	await page.goto('/login');
	const request = page.getByRole('button', { name: 'Anmeldelink anfordern' });
	await expect(request).toBeEnabled();
	await page.getByLabel('E-Mail').fill(email);
	await request.click();
	await expect(page.getByRole('status')).toContainText(email);
	await page.goto(await latestLink(email, /magic-link/u));
	await expect(page.getByRole('heading', { name: 'Deine Bereiche' })).toBeVisible();
}

export { signIn };
