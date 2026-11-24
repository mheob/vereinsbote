import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

import { expectNoA11yViolations } from './helpers/a11y';
import { signIn } from './helpers/sign-in';

/*
 * The contacts, as the admin and a reader of another area see them. Runs after the project
 * `fundament`, which set the club up (admin@verein.test, areas „Mitglieder“ and „Finanzen“). The
 * tests build on each other and share the pages of the signed-in users.
 */
test.describe.configure({ mode: 'serial' });

// oxlint-disable-next-line init-declarations -- signed in once in `beforeAll`, shared by the serial tests
let admin: Page;

test.beforeAll(async ({ browser }) => {
	// Far from UTC: a date that went through the local time zone anywhere would be a day off here.
	const context = await browser.newContext({ locale: 'de-DE', timezoneId: 'Pacific/Honolulu' });
	admin = await context.newPage();
	await signIn(admin, 'admin@verein.test');
});

test.afterAll(async () => {
	await admin.context().close();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('prepares access and shows the empty contact list', async () => {
	await admin.goto('/admin/users');
	await admin.getByLabel('Finanzen für Alex Admin').click();
	await admin.getByRole('option', { name: 'Bearbeiten' }).click();
	await expect(admin.getByRole('status')).toHaveText('Finanzen für Alex Admin: Bearbeiten');
	// Uli only reads „Finanzen“, the partners area.
	await admin.getByLabel('Name').fill('Uli');
	await admin.getByLabel('E-Mail').fill('uli@verein.test');
	await admin.getByRole('button', { name: 'Einladen' }).click();
	await admin.getByLabel('Finanzen für Uli').click();
	await admin.getByRole('option', { name: 'Lesen' }).click();
	await expect(admin.getByRole('status')).toHaveText('Finanzen für Uli: Lesen');

	await admin.goto('/');
	const nav = admin.getByRole('navigation', { name: 'Hauptnavigation' });
	await expect(nav.getByRole('link', { name: 'Mitglieder importieren' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Partner importieren' })).toBeVisible();
	await expect(admin.getByText('Es wurden noch keine Mitglieder importiert.')).toBeVisible();
	await expectNoA11yViolations(admin);
	await nav.getByRole('link', { name: 'Kontakte' }).click();
	await expect(admin).toHaveTitle('Kontakte – Vereinsbote');
	await expect(admin.getByRole('tab', { name: 'Mitglieder', selected: true })).toBeVisible();
	await expect(admin.getByText('Keine Kontakte gefunden.')).toBeVisible();
	await expectNoA11yViolations(admin);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('switches to the partners and searches without the term in the URL', async () => {
	const urls: string[] = [];
	const recordUrl = (request: Request): void => {
		urls.push(request.url());
	};
	admin.on('request', recordUrl);
	await admin.goto('/contacts');
	await expect(admin.getByRole('button', { name: 'Suchen' })).toBeEnabled();
	// The admin edits „Mitglieder“ and so sees the members' exit date.
	await expect(admin.getByRole('button', { name: /Austritt$/u })).toBeVisible();
	// The tabs are links: the arrow key opens the partners in the same document.
	await admin.getByRole('tab', { name: 'Mitglieder' }).focus();
	await admin.keyboard.press('ArrowRight');
	await expect(admin).toHaveURL(/\/contacts\?kind=partner$/u);
	await expect(admin.getByRole('tab', { name: 'Partner', selected: true })).toBeFocused();
	await expect(admin.getByRole('button', { name: /Schlagwort$/u })).toBeVisible();
	await expect(admin.getByRole('button', { name: /Austritt$/u })).toHaveCount(0);
	await admin.getByLabel('Suche', { exact: true }).fill('Bäckerei');
	// The visible box covers the hidden input of the checkbox; the click lands on it, as a user's would.
	await admin.getByRole('checkbox', { name: 'Gesperrt' }).check({ force: true });
	await admin.getByRole('button', { name: 'Suchen' }).click();
	await expect(admin.getByRole('status')).toHaveText('0 Kontakte gefunden.');
	await expect(admin.getByText('Keine Kontakte gefunden.')).toBeVisible();
	await expectNoA11yViolations(admin);
	admin.off('request', recordUrl);
	// The search went by POST: no address of the page or of a request carries the term.
	expect(urls.filter((url) => /B%C3%A4ckerei|Bäckerei/iu.test(url))).toStrictEqual([]);
	await expect(admin).toHaveURL(/\/contacts\?kind=partner$/u);
	// Back to the members: the list starts again without search and announcement.
	await admin.getByRole('tab', { name: 'Mitglieder' }).click();
	await expect(admin).toHaveURL(/\/contacts$/u);
	await expect(admin.getByLabel('Suche', { exact: true })).toHaveValue('');
	await expect(admin.getByRole('status')).toHaveText('');
});
