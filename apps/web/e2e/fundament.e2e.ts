import { expect, test } from '@playwright/test';

import { E2E_SETUP_TOKEN, E2E_URL } from './env';
import { expectNoA11yViolations } from './helpers/a11y';
import { latestLink } from './helpers/mailpit';

const HTTP_NOT_FOUND = 404;

/*
 * The forms submit through React, so their buttons stay pending (`aria-disabled`) until the page
 * is hydrated. The tests wait for an enabled button before they type, so no input gets lost.
 * Actions that save in the background are awaited through the page's status message.
 */

// oxlint-disable-next-line max-statements -- one flow through the app, step by step, as two users see it
test('setup, invitation, sign-in, permissions, blocking and sign-out', async ({
	page,
	browser,
}) => {
	await page.goto('/setup');
	await expect(page.getByRole('button', { name: 'Einrichtung abschließen' })).toBeEnabled();
	await expect(page).toHaveTitle('Ersteinrichtung – Vereinsbote');
	await expectNoA11yViolations(page);
	await page.getByLabel('Einrichtungs-Token').fill(E2E_SETUP_TOKEN);
	await page.getByLabel('Name').fill('Alex Admin');
	await page.getByLabel('E-Mail').fill('admin@verein.test');
	await page.getByRole('button', { name: 'Einrichtung abschließen' }).click();
	await expect(page).toHaveURL(/\/admin\/users$/u);
	await expect(page.getByRole('heading', { exact: true, name: 'Benutzer' })).toBeVisible();
	await expect(page).toHaveTitle('Benutzer – Vereinsbote');
	await expectNoA11yViolations(page);

	await page.getByLabel('Name').fill('Kim');
	await page.getByLabel('E-Mail').fill('kim@verein.test');
	await page.getByRole('button', { name: 'Einladen' }).click();
	await page.getByLabel('Finanzen für Kim').click();
	await page.getByRole('option', { name: 'Lesen' }).click();
	await expect(page.getByRole('status')).toHaveText('Finanzen für Kim: Lesen');
	expect(await latestLink('kim@verein.test', /\/login/u)).toMatch(/\/login$/u);

	const kimContext = await browser.newContext();
	const kim = await kimContext.newPage();
	await kim.goto('/login');
	await expect(kim.getByRole('button', { name: 'Anmeldelink anfordern' })).toBeEnabled();
	await expect(kim).toHaveTitle('Anmelden – Vereinsbote');
	await expectNoA11yViolations(kim);
	await kim.getByLabel('E-Mail').fill(' Kim@Verein.test');
	await kim.getByRole('button', { name: 'Anmeldelink anfordern' }).click();
	await kim.goto(await latestLink('kim@verein.test', /magic-link/u));
	await expect(kim.getByRole('heading', { name: 'Deine Bereiche' })).toBeVisible();
	await expectNoA11yViolations(kim);
	await expect(kim.getByText('Finanzen – Lesen')).toBeVisible();
	await expect(kim.getByText(/Mitglieder/u)).toHaveCount(0);
	await kim.goto('/admin/users');
	await expect(kim.getByRole('heading', { name: 'Kein Zugriff' })).toBeVisible();
	await expectNoA11yViolations(kim);

	const kimRow = page.getByRole('row', { name: /Kim/u });
	await kimRow.getByRole('button', { name: 'Sperren' }).click();
	await expect(page.getByRole('dialog', { name: 'Kim sperren?' })).toBeVisible();
	await expectNoA11yViolations(page);
	await page.getByRole('button', { name: 'Ja, sperren' }).click();
	await expect(page.getByRole('status')).toHaveText('Kim wurde gesperrt.');
	await kim.goto('/');
	await expect(kim).toHaveURL(/\/login$/u);
	await kimContext.close();

	// Kim had signed in before, so the account is active again.
	await kimRow.getByRole('button', { name: 'Entsperren' }).click();
	await expect(page.getByRole('status')).toHaveText('Kim wurde entsperrt.');
	await expect(kimRow.getByRole('cell', { name: 'Aktiv' })).toBeVisible();

	await page.goto('/admin');
	await expect(page).toHaveURL(/\/admin\/users$/u);
	await page.goto('/admin/areas');
	await expect(page.getByRole('heading', { exact: true, name: 'Bereiche' })).toBeVisible();
	await expect(page).toHaveTitle('Bereiche – Vereinsbote');
	await expectNoA11yViolations(page);

	await page.getByRole('button', { name: 'Abmelden' }).click();
	await expect(page).toHaveURL(/\/login$/u);
	await expect(page.getByRole('button', { name: 'Abmelden' })).toHaveCount(0);
	await page.goto('/admin/users');
	await expect(page).toHaveURL(/\/login$/u);
});

test('switches the sign-in page to English', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByRole('button', { name: 'Anmeldelink anfordern' })).toBeEnabled();
	await page.getByRole('button', { name: 'English' }).click();
	await expect(page.getByRole('button', { name: 'Request sign-in link' })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page).toHaveTitle('Sign in – Vereinsbote');
	await expectNoA11yViolations(page);
});

test('answers an unknown address with an English 404 page', async ({ page }) => {
	await page.context().addCookies([{ name: 'locale', url: E2E_URL, value: 'en' }]);
	const response = await page.goto('/no-such-page');
	expect(response?.status()).toBe(HTTP_NOT_FOUND);
	await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	await expect(page).toHaveTitle('Page not found – Vereinsbote');
	await expectNoA11yViolations(page);
});

test('answers an unknown address with a German 404 page', async ({ page }) => {
	const response = await page.goto('/gibt-es-nicht');
	expect(response?.status()).toBe(HTTP_NOT_FOUND);
	await expect(page.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible();
	await expect(page).toHaveTitle('Seite nicht gefunden – Vereinsbote');
	await page.getByRole('link', { name: 'Zur Startseite' }).click();
	await expect(page).toHaveURL(/\/login$/u);
});

test('sends the security headers with pages and API responses', async ({ page, request }) => {
	const securityHeaders = {
		'content-security-policy': "frame-ancestors 'none'",
		'referrer-policy': 'strict-origin-when-cross-origin',
		'x-content-type-options': 'nosniff',
		'x-frame-options': 'DENY',
	};
	const response = await page.goto('/login');
	expect(response?.headers()).toMatchObject(securityHeaders);
	const health = await request.get('/api/health');
	expect(health.headers()).toMatchObject(securityHeaders);
});
