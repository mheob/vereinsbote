import { expect, test } from '@playwright/test';
import type { Locator, Page, Request } from '@playwright/test';

import { memberExportRows, memberExportXlsx, XLSX_MIME } from './fixtures/member-export';
import type { MemberExportRow } from './fixtures/member-export';
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

/** Uli, who reads „Finanzen“; signed in by the test that hides protected fields, then kept. */
// oxlint-disable-next-line init-declarations -- set by a serial test, closed in `afterAll`
let uliPage: Page | undefined;

test.beforeAll(async ({ browser }) => {
	// Far from UTC: a date that went through the local time zone anywhere would be a day off here.
	const context = await browser.newContext({ locale: 'de-DE', timezoneId: 'Pacific/Honolulu' });
	admin = await context.newPage();
	await signIn(admin, 'admin@verein.test');
});

test.afterAll(async () => {
	await admin.context().close();
	await uliPage?.context().close();
});

/** The second member import keeps the first 30 of the 39 members, so 9 go: more than 20 %. */
const KEPT_MEMBERS = 30;

/** The status of a page the user may not open. */
const HTTP_FORBIDDEN = 403;

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
test('asks for the sheet of a workbook and names an empty one', async () => {
	await admin.goto('/contacts/import/members');
	const rows = memberExportRows(new Date()).slice(0, KEPT_MEMBERS);
	const buffer = await memberExportXlsx(rows, 'Deckblatt');
	await upload(admin, { buffer, mimeType: XLSX_MIME, name: 'mitglieder.xlsx' });
	// React Aria's hidden select carries the label as well, so the select is found as its button.
	const sheet = admin.getByRole('button', { name: /Blatt$/u });
	await expect(sheet).toBeFocused();
	await expect(sheet).toContainText('Mitglieder');
	await expectNoA11yViolations(admin);
	await sheet.click();
	await admin.getByRole('option', { name: 'Deckblatt' }).click();
	// The read ends after the focus is back on the select: an alert reads the error out.
	await expect(admin.getByRole('alert')).toHaveText('Die Datei oder das Blatt ist leer.');
	await expect(admin.getByRole('button', { name: 'Weiter zur Zuordnung' })).toHaveCount(0);
	await expectNoA11yViolations(admin);
	await sheet.click();
	await admin.getByRole('option', { name: 'Mitglieder' }).click();
	await expect(admin.getByRole('alert')).toHaveCount(0);
	await admin.getByRole('button', { name: 'Weiter zur Zuordnung' }).click();
	await expect(admin.getByRole('heading', { name: 'Schritt 2 von 4: Zuordnung' })).toBeFocused();
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

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('deletes a partner missing from the export only when it is ticked', async () => {
	await admin.goto('/contacts/import/partners');
	const buffer = partnerExportCsv(['100003', '100004']);
	await upload(admin, { buffer, mimeType: 'text/csv', name: 'partner.csv' });
	// The remembered mapping keeps the organization rule, so the stored partners stay as they are.
	const rule = 'Ist der Vorname leer, ist der Nachname die Firma';
	await expect(admin.getByRole('checkbox', { name: rule })).toBeChecked();
	await toPreview(admin);
	const missing = admin.getByRole('group', {
		name: 'Nicht mehr im Export – zum Löschen ankreuzen',
	});
	await expect(missing.getByRole('checkbox')).toHaveCount(2);
	await tick(admin, '100004 Autohaus Schäfer OHG');
	await expectNoA11yViolations(admin);
	await admin.getByRole('button', { name: 'Import bestätigen' }).click();
	await expect(admin.getByRole('status')).toHaveText(
		'Import abgeschlossen: 0 neu, 0 geändert, 1 gelöscht.',
	);
	// Only the ticked partner is gone; the other one missing from the export stays.
	await admin.goto('/contacts?kind=partner');
	await expect(admin.getByText('Sporthaus Großmann')).toBeVisible();
	await expect(admin.getByText('Autohaus Schäfer OHG')).toHaveCount(0);
});

/**
 * Opens a member from the contact list: search by last name, then the link of the name.
 *
 * @param page The page of a signed-in user.
 * @param row The member's row of the export.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see upload
async function openMember(page: Page, row: MemberExportRow): Promise<void> {
	await page.goto('/contacts');
	const search = page.getByRole('button', { name: 'Suchen' });
	await expect(search).toBeEnabled();
	await page.getByLabel('Suche', { exact: true }).fill(row.lastName);
	await search.click();
	await expect(page.getByRole('status')).toHaveText('1 Kontakt gefunden.');
	await page.getByRole('link', { name: `${row.firstName} ${row.lastName}` }).click();
}

/**
 * The first member of the export, who stays through the second import.
 *
 * @returns The row.
 */
function firstMember(): MemberExportRow {
	const [first] = memberExportRows(new Date());
	if (first === undefined) throw new Error('The export has no rows.');
	return first;
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('shows a member, suppresses it and records an opt-out', async () => {
	const first = firstMember();
	await openMember(admin, first);
	await expect(admin).toHaveTitle('Kontakt – Vereinsbote');
	await expect(
		admin.getByRole('heading', { level: 1, name: `${first.firstName} ${first.lastName}` }),
	).toBeVisible();
	// Read in Honolulu and still the same calendar day.
	const birthday = first.birthday.toLocaleDateString('de-DE', {
		day: '2-digit',
		month: '2-digit',
		timeZone: 'UTC',
		year: 'numeric',
	});
	await expect(admin.getByText(birthday)).toBeVisible();
	await expect(admin.getByText('Änderungen in der Mitgliederverwaltung vornehmen.')).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
	await expectNoA11yViolations(admin);
	await admin.getByRole('button', { name: 'Keine Mails mehr' }).click();
	await expect(admin.getByRole('status')).toHaveText('Der Kontakt bekommt keine Mails mehr.');
	await expect(admin.getByText(/^Gesperrt seit /u)).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Sperre aufheben' })).toBeFocused();
	await tick(admin, 'Widerspruch für Finanzen');
	await expect(admin.getByRole('status')).toHaveText('Widerspruch für Finanzen gespeichert.');
	await expectNoA11yViolations(admin);
	// The list shows the suppression as well.
	await admin.getByRole('link', { name: 'Zurück zur Kontaktliste' }).click();
	const name = `${first.firstName} ${first.lastName}`;
	await expect(admin.getByRole('row', { name })).toContainText('Gesperrt');
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('creates, edits and deletes a partner with tags', async () => {
	await admin.goto('/contacts?kind=partner');
	await admin.getByRole('link', { name: 'Partner anlegen' }).click();
	await expect(admin).toHaveTitle('Partner anlegen – Vereinsbote');
	await admin.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByText('Bitte gib einen Namen oder eine Firma ein.')).toBeVisible();
	await expect(
		admin.getByText('Bitte gib eine Kundennummer oder eine E-Mail-Adresse ein.'),
	).toBeVisible();
	// The focus moves to the first refused field, where the name is missing.
	await expect(admin.getByLabel('Firma')).toBeFocused();
	await expectNoA11yViolations(admin);
	await admin.getByLabel('Firma').fill('Sportpresse Nord');
	await admin.getByLabel('E-Mail').fill('redaktion@sportpresse.example');
	await admin.getByLabel('Schlagwort hinzufügen').fill('Presse');
	await admin.keyboard.press('Enter');
	await expect(admin.getByRole('row', { name: 'Presse' })).toBeVisible();
	await expect(admin.getByLabel('Schlagwort hinzufügen')).toHaveValue('');
	// A date without the year is refused at the field, not saved as empty.
	const birthDate = admin.getByRole('group', { name: 'Geburtsdatum' }).getByRole('spinbutton');
	await birthDate.first().click();
	await admin.keyboard.type('1705');
	await admin.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByText('Bitte prüfe die Eingabe.')).toBeVisible();
	await expect(birthDate.first()).toBeFocused();
	await expect(admin.getByRole('heading', { name: 'Partner anlegen' })).toBeVisible();
	await expect(admin.getByRole('status')).not.toHaveText('Gespeichert.');
	await expectNoA11yViolations(admin);
	await birthDate.last().click();
	await admin.keyboard.type('1980');
	await admin.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByRole('heading', { name: 'Sportpresse Nord' })).toBeVisible();
	await expect(admin.getByText('17.05.1980')).toBeVisible();
	await expect(admin.getByRole('status')).toHaveText('Gespeichert.');
	await expect(admin.getByText('redaktion@sportpresse.example')).toBeVisible();
	await expectNoA11yViolations(admin);

	await admin.getByRole('button', { name: 'Bearbeiten' }).click();
	await expect(admin.getByRole('heading', { name: 'Partner bearbeiten' })).toBeVisible();
	// The Bäckerei has this customer number.
	await admin.getByLabel('Kundennummer').fill('100001');
	await admin.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByText('Diese Kundennummer hat schon ein anderer Partner.')).toBeVisible();
	await expect(admin.getByLabel('Kundennummer')).toBeFocused();
	await expectNoA11yViolations(admin);
	await admin.getByLabel('Kundennummer').fill('100099');
	// The last tag goes: the focus moves to the input, where the next one is typed.
	await admin.getByRole('row', { name: 'Presse' }).getByRole('button').click();
	await expect(admin.getByRole('status')).toHaveText('Schlagwort Presse entfernt.');
	const tagInput = admin.getByLabel('Schlagwort hinzufügen');
	await expect(tagInput).toBeFocused();
	// The stored tag is suggested again; Enter takes the chosen suggestion once.
	await admin.keyboard.type('pre');
	await expect(admin.getByRole('option', { name: 'Presse' })).toBeVisible();
	await admin.keyboard.press('ArrowDown');
	await admin.keyboard.press('Enter');
	await expect(admin.getByRole('status')).toHaveText('Schlagwort Presse hinzugefügt.');
	await expect(admin.getByRole('row', { name: 'Presse' })).toHaveCount(1);
	await expect(tagInput).toHaveValue('');
	await admin.keyboard.type('Sponsor');
	await admin.keyboard.press('Enter');
	await expect(admin.getByRole('status')).toHaveText('Schlagwort Sponsor hinzugefügt.');
	await expectNoA11yViolations(admin);
	await admin.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByRole('status')).toHaveText('Gespeichert.');
	await expect(admin.getByRole('heading', { name: 'Partner bearbeiten' })).toHaveCount(0);
	await expect(admin.getByRole('button', { name: 'Bearbeiten' })).toBeFocused();
	await expect(admin.getByText('100099')).toBeVisible();
	await expect(admin.getByText('Presse, Sponsor', { exact: true })).toBeVisible();

	// The list shows the partner; its name leads back to it.
	await admin.getByRole('link', { name: 'Zurück zur Kontaktliste' }).click();
	await expect(admin).toHaveURL(/\/contacts\?kind=partner$/u);
	await admin.getByRole('link', { name: 'Sportpresse Nord' }).click();
	await admin.getByRole('button', { name: 'Löschen' }).click();
	await expect(admin.getByRole('dialog', { name: 'Sportpresse Nord löschen?' })).toBeVisible();
	await expectNoA11yViolations(admin);
	await admin.getByRole('button', { name: 'Ja, löschen' }).click();
	await expect(admin.getByRole('status')).toHaveText('Sportpresse Nord wurde gelöscht.');
	await expect(admin).toHaveURL(/\/contacts\?kind=partner$/u);
	await expect(admin.getByRole('table').getByText('Sportpresse Nord')).toHaveCount(0);
	// A reload does not announce the deletion again.
	await admin.reload();
	await expect(admin.getByRole('button', { name: 'Suchen' })).toBeEnabled();
	await expect(admin.getByRole('status')).toHaveText('');
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as a reader of „Finanzen“ sees it
test('hides protected member fields from a reader of another area', async ({ browser }) => {
	const context = await browser.newContext({ locale: 'de-DE' });
	const uli = await context.newPage();
	await signIn(uli, 'uli@verein.test');
	await openMember(uli, firstMember());
	await expect(uli).toHaveTitle('Kontakt – Vereinsbote');
	await expect(uli.getByText('Geburtsdatum')).toHaveCount(0);
	await expect(uli.getByRole('button', { name: 'Keine Mails mehr' })).toHaveCount(0);
	// Without the right Uli sees the opt-out as a list, without checkboxes.
	await expect(uli.getByText('Finanzen, seit ')).toBeVisible();
	await expect(uli.getByRole('checkbox')).toHaveCount(0);
	await expect(
		uli
			.getByRole('navigation', { name: 'Hauptnavigation' })
			.getByRole('link', { name: 'Mitglieder importieren' }),
	).toHaveCount(0);
	await expectNoA11yViolations(uli);
	// Uli only reads the partners: no partner can be added.
	const response = await uli.goto('/contacts/new');
	expect(response?.status()).toBe(HTTP_FORBIDDEN);
	await expect(uli).toHaveTitle('Kein Zugriff – Vereinsbote');
	await expect(uli.getByRole('heading', { name: 'Kein Zugriff' })).toBeVisible();
	await expectNoA11yViolations(uli);
	// Uli stays signed in: the contact settings change what Uli sees.
	uliPage = uli;
});

/**
 * Ticks or unticks a checkbox of the field protection by its box, as a user does. The table
 * names the checkbox by its row and column; the box covers the hidden input (C20).
 *
 * @param page The page of the contact settings.
 * @param name The label of the checkbox.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see upload
async function toggleBox(page: Page, name: string): Promise<void> {
	await page
		.locator('label')
		.filter({ has: page.getByRole('checkbox', { exact: true, name }) })
		.click();
}

/**
 * Uli's page, which the test that hides protected fields signed in.
 *
 * @returns The page.
 */
function signedInUli(): Page {
	if (uliPage === undefined) throw new Error('Uli is not signed in.');
	return uliPage;
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin and Uli see it
test('assigns a protected member field to another area', async () => {
	const uli = signedInUli();
	await openMember(uli, firstMember());
	await expect(uli.getByText('Geburtsdatum')).toHaveCount(0);
	await admin.goto('/admin/users');
	await admin
		.getByRole('navigation', { name: 'Verwaltung' })
		.getByRole('link', { name: 'Kontakt-Einstellungen' })
		.click();
	await expect(admin).toHaveTitle('Kontakt-Einstellungen – Vereinsbote');
	await expectNoA11yViolations(admin);
	const forFinance = 'Geburtsdatum (Mitglieder) für Finanzen';
	const forMembers = 'Geburtsdatum (Mitglieder) für Mitglieder';
	const checkbox = (name: string): Locator => admin.getByRole('checkbox', { exact: true, name });
	await expect(checkbox(forMembers)).toBeChecked();
	await expect(checkbox(forFinance)).not.toBeChecked();
	await toggleBox(admin, forFinance);
	// The areas in the order of the area list, by name.
	await expect(admin.getByRole('status')).toHaveText(
		'Geburtsdatum (Mitglieder): Finanzen, Mitglieder',
	);
	await expect(checkbox(forFinance)).toBeChecked();
	await toggleBox(admin, forMembers);
	await expect(admin.getByRole('status')).toHaveText('Geburtsdatum (Mitglieder): Finanzen');
	await expect(checkbox(forMembers)).not.toBeChecked();
	await toggleBox(admin, forFinance);
	await expect(admin.getByRole('alert')).toHaveText('Mindestens ein Bereich muss bleiben.');
	await expect(checkbox(forFinance)).toBeChecked();
	await expectNoA11yViolations(admin);
	// Uli reads „Finanzen“ and now sees the members' dates of birth.
	await uli.reload();
	await expect(uli.getByText('Geburtsdatum')).toBeVisible();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('saves the areas and the period for old data', async () => {
	await admin.goto('/admin/contact-settings');
	const areasForm = admin.getByRole('form', { name: 'Bereiche' });
	await expect(areasForm.getByLabel('Mitglieder-Bereich')).toContainText('Mitglieder');
	await expect(areasForm.getByLabel('Partner-Bereich')).toContainText('Finanzen');
	await areasForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByRole('status')).toHaveText('Die Bereiche sind gespeichert.');

	const periodForm = admin.getByRole('form', { name: 'Frist für alte Daten' });
	const weeks = periodForm.getByLabel('Wochen');
	await expect(weeks).toHaveValue('8');
	// Out of range is shown at the field, not clamped to 52.
	await weeks.fill('60');
	await periodForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(periodForm.getByText('Bitte gib 1 bis 52 Wochen ein.')).toBeVisible();
	await expect(weeks).toBeFocused();
	await expect(weeks).toHaveValue('60');
	await expectNoA11yViolations(admin);
	await weeks.fill('6');
	await periodForm.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByRole('status')).toHaveText('Die Frist ist gespeichert.');
	await expect(periodForm.getByText('Bitte gib 1 bis 52 Wochen ein.')).toHaveCount(0);
	await admin.reload();
	await expect(
		admin.getByRole('form', { name: 'Frist für alte Daten' }).getByLabel('Wochen'),
	).toHaveValue('6');
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('makes a custom field from an import a base field and protects it again', async () => {
	await admin.goto('/admin/contact-settings');
	await expect(
		admin.getByText('Es gibt noch keine Zusatzfelder. Sie entstehen beim Import.'),
	).toBeVisible();
	await admin.goto('/contacts/import/partners');
	await upload(admin, { buffer: partnerExportCsv(), mimeType: 'text/csv', name: 'partner.csv' });
	await admin.getByLabel('Typ zuordnen').click();
	await admin.getByRole('option', { name: 'Neues Zusatzfeld' }).click();
	await expect(admin.getByLabel('Name des Zusatzfelds für Typ')).toHaveValue('Typ');
	await toPreview(admin);
	await admin.getByRole('button', { name: 'Import bestätigen' }).click();
	await expect(admin.getByRole('status')).toHaveText(/^Import abgeschlossen: /u);

	await admin.goto('/admin/contact-settings');
	// A new custom field is protected and belongs to the partners area.
	const typeForFinance = admin.getByRole('checkbox', {
		exact: true,
		name: 'Typ (Partner) für Finanzen',
	});
	await expect(typeForFinance).toBeChecked();
	const protection = admin.getByLabel('Schutz von Typ');
	await expect(protection).toContainText('Geschützt');
	await expectNoA11yViolations(admin);
	await protection.click();
	await admin.getByRole('option', { name: 'Basisfeld' }).click();
	await expect(admin.getByRole('status')).toHaveText('Schutz von Typ: Basisfeld');
	await expect(typeForFinance).toHaveCount(0);
	await protection.click();
	await admin.getByRole('option', { name: 'Geschützt' }).click();
	await expect(admin.getByRole('status')).toHaveText('Schutz von Typ: Geschützt');
	await expect(typeForFinance).toBeChecked();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it in two tabs
test('refuses a field that became a base field in another tab', async () => {
	const stale = await admin.context().newPage();
	await stale.goto('/admin/contact-settings');
	// The form buttons are pending until the page is hydrated.
	await expect(
		stale.getByRole('form', { name: 'Frist für alte Daten' }).getByRole('button'),
	).toBeEnabled();
	const typeForMembers = 'Typ (Partner) für Mitglieder';
	await expect(
		stale.getByRole('checkbox', { exact: true, name: typeForMembers }),
	).not.toBeChecked();
	await admin.goto('/admin/contact-settings');
	await admin.getByLabel('Schutz von Typ').click();
	await admin.getByRole('option', { name: 'Basisfeld' }).click();
	await expect(admin.getByRole('status')).toHaveText('Schutz von Typ: Basisfeld');
	await toggleBox(stale, typeForMembers);
	await expect(stale.getByRole('alert')).toHaveText(
		'Die Einstellung wurde inzwischen geändert. Die Seite zeigt jetzt den aktuellen Stand.',
	);
	// The page shows the current state: the base field has no row any more.
	await expect(stale.getByRole('checkbox', { exact: true, name: typeForMembers })).toHaveCount(0);
	await expect(stale.getByLabel('Schutz von Typ')).toContainText('Basisfeld');
	await expectNoA11yViolations(stale);
	await stale.close();
});
