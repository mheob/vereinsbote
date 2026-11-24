import { expect, test } from '@playwright/test';
import type { Locator, Page, Request } from '@playwright/test';

import { memberExportRows, memberExportXlsx, XLSX_MIME } from './fixtures/member-export';
import { partnerExportCsv } from './fixtures/partner-export';
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

/** The second member import keeps the first 30 of the 39 members, so 9 go: more than 20 %. */
const KEPT_MEMBERS = 30;

/** A file as the file chooser gives it. */
type UploadFile = Readonly<{ name: string; mimeType: string; buffer: Buffer }>;

/**
 * Chooses a file with „Datei auswählen“, once the page is hydrated (the button is pending
 * before).
 *
 * @param page The page of the import.
 * @param file The file.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function upload(page: Page, file: UploadFile): Promise<void> {
	const button = page.getByRole('button', { name: 'Datei auswählen' });
	await expect(button).toBeEnabled();
	const chooser = page.waitForEvent('filechooser');
	await button.click();
	const fileChooser = await chooser;
	await fileChooser.setFiles(file);
}

/**
 * Goes on from the mapping to the preview.
 *
 * @param page The page of the import.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see upload
async function toPreview(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Weiter zur Vorschau' }).click();
	await expect(page.getByRole('heading', { name: 'Schritt 3 von 4: Vorschau' })).toBeFocused();
}

/**
 * A row of the counts table of the preview; only that table, so no other row matches.
 *
 * @param page The page of the import.
 * @param kind Whose counts: „Mitgliedern“ or „Partnern“.
 * @param label The label of the count.
 * @returns The row.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see upload
function countRow(page: Page, kind: 'Mitgliedern' | 'Partnern', label: string): Locator {
	return page
		.getByRole('table', { name: `Was der Import an den ${kind} ändert` })
		.getByRole('row', { name: new RegExp(`^${label}\\b`, 'u') });
}

/**
 * Ticks a checkbox by its label, as a user does; the styled box covers the input (C20).
 *
 * @param page The page.
 * @param label The label of the checkbox.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see upload
async function tick(page: Page, label: string): Promise<void> {
	await page.getByText(label, { exact: true }).click();
	await expect(page.getByRole('checkbox', { name: label })).toBeChecked();
}

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

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('imports members from an XLSX export', async () => {
	await admin
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Mitglieder importieren' })
		.click();
	await expect(admin).toHaveTitle('Mitglieder importieren – Vereinsbote');
	await expect(admin.getByRole('heading', { name: 'Schritt 1 von 4: Datei' })).toBeVisible();
	await expectNoA11yViolations(admin);
	const buffer = await memberExportXlsx(memberExportRows(new Date()));
	await upload(admin, { buffer, mimeType: XLSX_MIME, name: 'mitglieder.xlsx' });
	await expect(admin.getByRole('heading', { name: 'Schritt 2 von 4: Zuordnung' })).toBeFocused();
	await expect(admin.getByRole('status')).toHaveText('Schritt 2 von 4: Zuordnung');
	await expect(admin.getByLabel('Nr. zuordnen')).toContainText('Mitgliedsnummer');
	await expect(admin.getByLabel('Typ zuordnen')).toContainText('Verwerfen');
	await expect(admin.getByLabel('Abteilungen zuordnen')).toContainText('Zu Gruppen hinzufügen');
	await expectNoA11yViolations(admin);
	await toPreview(admin);
	// Row 39 has left the club yesterday.
	await expect(countRow(admin, 'Mitgliedern', 'Neu')).toContainText('39');
	await expectNoA11yViolations(admin);
	await admin.getByRole('button', { name: 'Import bestätigen' }).click();
	await expect(admin.getByRole('status')).toHaveText(
		'Import abgeschlossen: 39 neu, 0 geändert, 0 gelöscht.',
	);
	await expect(admin.getByRole('heading', { name: 'Schritt 4 von 4: Ergebnis' })).toBeFocused();
	await expect(admin.getByRole('link', { name: 'Zur Kontaktliste' })).toBeVisible();
	// The page was loaded anew after the import (the frame as well): it knows the import now.
	await expect(admin.getByText(/^Letzter Import am /u)).toBeVisible();
	await expectNoA11yViolations(admin);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('imports members again with the remembered mapping and the safety check', async () => {
	await admin.goto('/contacts/import/members');
	const buffer = await memberExportXlsx(memberExportRows(new Date()).slice(0, KEPT_MEMBERS));
	await upload(admin, { buffer, mimeType: XLSX_MIME, name: 'mitglieder.xlsx' });
	await expect(admin.getByText('Die Zuordnung vom letzten Import wurde übernommen.')).toBeVisible();
	await toPreview(admin);
	// 9 of 39: more than 20 % of the stock.
	await expect(countRow(admin, 'Mitgliedern', 'Entfällt')).toContainText('9');
	await admin.getByRole('button', { name: 'Import bestätigen' }).click();
	await expect(admin.getByText('Bitte bestätige die Löschungen.')).toBeVisible();
	const confirmation = 'Ich bestätige, dass 9 Mitglieder gelöscht werden.';
	await expect(admin.getByRole('checkbox', { name: confirmation })).toBeFocused();
	await expectNoA11yViolations(admin);
	await tick(admin, confirmation);
	await admin.getByRole('button', { name: 'Import bestätigen' }).click();
	await expect(admin.getByRole('status')).toHaveText(
		'Import abgeschlossen: 0 neu, 0 geändert, 9 gelöscht.',
	);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('imports partners from a Windows-1252 CSV with semicolons', async () => {
	await admin.goto('/contacts/import/partners');
	await expect(admin).toHaveTitle('Partner importieren – Vereinsbote');
	await upload(admin, { buffer: partnerExportCsv(), mimeType: 'text/csv', name: 'partner.csv' });
	await expect(admin.getByLabel('Nr. zuordnen')).toContainText('Kundennummer');
	await tick(admin, 'Ist der Vorname leer, ist der Nachname die Firma');
	await expectNoA11yViolations(admin);
	await toPreview(admin);
	await expect(countRow(admin, 'Partnern', 'Neu')).toContainText('6');
	await expectNoA11yViolations(admin);
	await admin.getByRole('button', { name: 'Import bestätigen' }).click();
	await expect(admin.getByRole('status')).toHaveText(
		'Import abgeschlossen: 6 neu, 0 geändert, 0 gelöscht.',
	);
	await expect(admin.getByText(/^Letzter Import am /u)).toBeVisible();
});
