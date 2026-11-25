import type { BrowserContext, Locator, Page } from '@playwright/test';

import { solidPng } from './fixtures/png';
import { expectNoA11yViolations } from './helpers/a11y';
import { newAdminContext } from './helpers/admin-session';
import { signIn } from './helpers/sign-in';
import { expect, test } from './helpers/test';

/*
 * The templates and the image library, as an editor and a reader of an area see them. Runs after
 * the projects `contacts` and `design`, which set the club up (admin@verein.test, the area
 * „Finanzen“, the CD) and saved the admin's session. The tests build on each other and share the
 * pages of the signed-in users.
 */
test.describe.configure({ mode: 'serial' });

/** The size of the test image, small enough to stay as it is. */
const IMAGE_WIDTH = 64;
const IMAGE_HEIGHT = 48;

// oxlint-disable-next-line init-declarations -- signed in once in `beforeAll`, shared by the serial tests
let admin: Page;
// oxlint-disable-next-line init-declarations -- signed in by the first test that needs them, closed in `afterAll`
let eva: Page;
// oxlint-disable-next-line init-declarations -- see eva
let rita: Page;

test.beforeAll(async ({ browser }, testInfo) => {
	const context = await newAdminContext(browser, testInfo);
	admin = await context.newPage();
});

/** The contexts of the users signed in by the tests, closed at the end. */
const userContexts: BrowserContext[] = [];

test.afterAll(async () => {
	await admin.context().close();
	await Promise.all(userContexts.map(async (context) => context.close()));
});

/**
 * Sets the level of a user in an area on the user page, as the admin does.
 *
 * @param page The admin's page on the user page.
 * @param access The area, the user's name and the level as the select names it.
 */
async function grant(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
	page: Page,
	access: Readonly<{ area: string; user: string; level: string }>,
): Promise<void> {
	const { area, level, user } = access;
	await page.getByLabel(`${area} für ${user}`).click();
	await page.getByRole('option', { name: level }).click();
	await expect(page.getByRole('status')).toHaveText(`${area} für ${user}: ${level}`);
}

/**
 * Invites a user on the user page.
 *
 * @param page The admin's page on the user page.
 * @param name The name.
 * @param email The address.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see grant
async function invite(page: Page, name: string, email: string): Promise<void> {
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('E-Mail').fill(email);
	await page.getByRole('button', { name: 'Einladen' }).click();
	await expect(page.getByRole('status')).toHaveText(`${name} wurde eingeladen.`);
}

/**
 * Chooses an option of a React Aria select by its label. The list of options opens in a popover
 * outside of any dialog, so the options are looked up on the page.
 *
 * @param page The page.
 * @param choice The label of the select, the option and, if the select is in a dialog, that dialog.
 */
async function choose(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
	page: Page,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a Playwright locator
	choice: Readonly<{ label: string; option: string; within?: Locator }>,
): Promise<void> {
	const { label, option, within = page } = choice;
	await within.getByRole('button', { name: new RegExp(`\\b${label}\\b`, 'u') }).click();
	await page.getByRole('option', { name: option }).click();
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('prepares the area and the users', async () => {
	await admin.goto('/admin/areas');
	await expect(admin.getByRole('button', { name: 'Anlegen' })).toBeEnabled();
	await admin.getByLabel('Name', { exact: true }).fill('Veranstaltungen');
	await admin.getByRole('button', { name: 'Anlegen' }).click();
	await expect(admin.getByRole('status')).toHaveText('Der Bereich Veranstaltungen wurde angelegt.');

	await admin.goto('/admin/users');
	await invite(admin, 'Eva', 'eva@verein.test');
	await grant(admin, { area: 'Veranstaltungen', level: 'Bearbeiten', user: 'Eva' });
	await grant(admin, { area: 'Finanzen', level: 'Bearbeiten', user: 'Eva' });
	await invite(admin, 'Rita', 'rita@verein.test');
	await grant(admin, { area: 'Veranstaltungen', level: 'Lesen', user: 'Rita' });
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an editor creates a template from the invitation starter', async ({ browser }) => {
	const context = await browser.newContext({ locale: 'de-DE' });
	userContexts.push(context);
	eva = await context.newPage();
	await signIn(eva, 'eva@verein.test');
	const nav = eva.getByRole('navigation', { name: 'Hauptnavigation' });
	await nav.getByRole('link', { name: 'Vorlagen' }).click();
	await expect(eva).toHaveURL(/\/templates$/u);
	await expect(eva).toHaveTitle('Vorlagen – Vereinsbote');
	await expect(eva.getByRole('heading', { exact: true, level: 1, name: 'Vorlagen' })).toBeVisible();
	await expect(eva.getByText('Es gibt noch keine Vorlagen.')).toBeVisible();
	await expectNoA11yViolations(eva);

	await eva.getByRole('link', { name: 'Neue Vorlage' }).click();
	await expect(eva).toHaveURL(/\/templates\/new$/u);
	await expect(eva).toHaveTitle('Neue Vorlage – Vereinsbote');
	const create = eva.getByRole('button', { name: 'Vorlage anlegen' });
	await expect(create).toBeEnabled();
	await expectNoA11yViolations(eva);

	await choose(eva, { label: 'Bereich', option: 'Veranstaltungen' });
	// Empty first: nothing is prefilled.
	await expect(eva.getByLabel('Name', { exact: true })).toHaveValue('');
	await eva.getByText('Einladung', { exact: true }).click();
	await expect(eva.getByRole('radio', { name: 'Einladung' })).toBeChecked();
	await expect(eva.getByLabel('Name', { exact: true })).toHaveValue('Einladung');
	await expect(eva.getByLabel('Betreff')).toHaveValue('Einladung zu [Veranstaltung]');
	await eva.getByLabel('Name', { exact: true }).fill('Sommerfest');
	await create.click();

	await expect(eva).toHaveURL(/\/templates\/[\w-]{36}$/u);
	await expect(eva).toHaveTitle('Vorlage – Vereinsbote');
	await expect(
		eva.getByRole('heading', { exact: true, level: 1, name: 'Sommerfest' }),
	).toBeVisible();
	await expect(eva.getByText('Einladung zu [Veranstaltung]')).toBeVisible();
	await expectNoA11yViolations(eva);

	// The same name again in the same area is refused at the field.
	await eva.goto('/templates/new');
	await expect(eva.getByRole('button', { name: 'Vorlage anlegen' })).toBeEnabled();
	await choose(eva, { label: 'Bereich', option: 'Veranstaltungen' });
	await eva.getByText('Einladung', { exact: true }).click();
	await eva.getByLabel('Name', { exact: true }).fill('sommerfest');
	await eva.getByRole('button', { name: 'Vorlage anlegen' }).click();
	await expect(
		eva.getByText('Eine Vorlage mit diesem Namen gibt es in diesem Bereich schon.'),
	).toBeVisible();
	await expect(eva).toHaveURL(/\/templates\/new$/u);
	await expectNoA11yViolations(eva);
});

test('an empty template can be created as well', async () => {
	await eva.goto('/templates/new');
	await expect(eva.getByRole('button', { name: 'Vorlage anlegen' })).toBeEnabled();
	await choose(eva, { label: 'Bereich', option: 'Veranstaltungen' });
	await eva.getByLabel('Name', { exact: true }).fill('Rundbrief');
	await eva.getByLabel('Betreff').fill('Neues vom Verein');
	await eva.getByRole('button', { name: 'Vorlage anlegen' }).click();
	await expect(
		eva.getByRole('heading', { exact: true, level: 1, name: 'Rundbrief' }),
	).toBeVisible();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the reader sees it
test('a reader sees templates but cannot change them', async ({ browser }) => {
	const context = await browser.newContext({ locale: 'de-DE' });
	userContexts.push(context);
	rita = await context.newPage();
	await signIn(rita, 'rita@verein.test');
	await rita
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Vorlagen' })
		.click();
	const table = rita.getByRole('grid', { name: 'Vorlagen' });
	await expect(table.getByRole('link', { exact: true, name: 'Sommerfest' })).toBeVisible();
	await expect(table.getByRole('row', { name: /Sommerfest/u })).toContainText('Veranstaltungen');
	await expect(table.getByRole('row', { name: /Sommerfest/u })).toContainText('Bausteine');
	await expect(rita.getByRole('link', { name: 'Neue Vorlage' })).toHaveCount(0);
	await expect(rita.getByRole('button', { name: /duplizieren|löschen/u })).toHaveCount(0);
	await expect(rita.getByRole('link', { name: /bearbeiten/u })).toHaveCount(0);
	await expectNoA11yViolations(rita);

	await table.getByRole('link', { exact: true, name: 'Sommerfest' }).click();
	await expect(
		rita.getByRole('heading', { exact: true, level: 1, name: 'Sommerfest' }),
	).toBeVisible();
	await expect(rita.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
	await expectNoA11yViolations(rita);

	// Creating needs `edit` somewhere: Rita only reads.
	await rita.goto('/templates/new');
	await expect(
		rita.getByText('Um Vorlagen anzulegen, brauchst du die Stufe „Bearbeiten“'),
	).toBeVisible();
	await expect(rita.getByRole('button', { name: 'Vorlage anlegen' })).toHaveCount(0);
	await expectNoA11yViolations(rita);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an editor filters, duplicates and deletes templates', async () => {
	await eva.goto('/templates');
	const table = eva.getByRole('grid', { name: 'Vorlagen' });
	await expect(table.getByRole('row', { name: /Rundbrief/u })).toBeVisible();

	// The filter by area; nothing of it goes into the URL.
	await choose(eva, { label: 'Bereich', option: 'Finanzen' });
	await expect(table.getByRole('link', { exact: true, name: 'Sommerfest' })).toHaveCount(0);
	await expect(eva.getByText('Es gibt noch keine Vorlagen.')).toBeVisible();
	await expect(eva).toHaveURL(/\/templates$/u);
	await choose(eva, { label: 'Bereich', option: 'Alle Bereiche' });
	await expect(table.getByRole('link', { exact: true, name: 'Sommerfest' })).toBeVisible();

	// Duplicate into another area where Eva edits: the copy opens and says so once.
	await eva.getByRole('button', { name: 'Sommerfest duplizieren' }).click();
	const dialog = eva.getByRole('dialog', { name: 'Sommerfest duplizieren' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel('Name der Kopie')).toHaveValue('Kopie von Sommerfest');
	await expectNoA11yViolations(eva);
	await choose(eva, { label: 'Zielbereich', option: 'Finanzen', within: dialog });
	await dialog.getByLabel('Name der Kopie').fill('Sommerfest Finanzen');
	await dialog.getByRole('button', { name: 'Duplizieren' }).click();
	await expect(eva).toHaveURL(/\/templates\/[\w-]{36}$/u);
	await expect(
		eva.getByRole('heading', { exact: true, level: 1, name: 'Sommerfest Finanzen' }),
	).toBeVisible();
	await expect(eva.getByText('Die Kopie „Sommerfest Finanzen“ wurde angelegt.')).toBeVisible();
	await expect(eva.getByText('Finanzen', { exact: true })).toBeVisible();
	// A reload does not show the notice again.
	await eva.reload();
	await expect(eva.getByText('Die Kopie „Sommerfest Finanzen“ wurde angelegt.')).toHaveCount(0);

	// The same name in the same area is refused in the dialog.
	await eva.goto('/templates');
	await eva.getByRole('button', { name: 'Sommerfest duplizieren' }).click();
	const again = eva.getByRole('dialog', { name: 'Sommerfest duplizieren' });
	await again.getByLabel('Name der Kopie').fill('Rundbrief');
	await again.getByRole('button', { name: 'Duplizieren' }).click();
	await expect(
		again.getByText('Eine Vorlage mit diesem Namen gibt es in diesem Bereich schon.'),
	).toBeVisible();
	await again.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(again).toHaveCount(0);

	// Delete with a confirmation; cancelling keeps the template.
	await eva.getByRole('button', { name: 'Sommerfest Finanzen löschen' }).click();
	const confirm = eva.getByRole('dialog', { name: '„Sommerfest Finanzen“ löschen?' });
	await expectNoA11yViolations(eva);
	await confirm.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(table.getByRole('link', { exact: true, name: 'Sommerfest Finanzen' })).toBeVisible();
	await eva.getByRole('button', { name: 'Sommerfest Finanzen löschen' }).click();
	await eva.getByRole('button', { name: 'Endgültig löschen' }).click();
	await expect(eva.getByText('Die Vorlage „Sommerfest Finanzen“ wurde gelöscht.')).toBeVisible();
	await expect(table.getByRole('link', { exact: true, name: 'Sommerfest Finanzen' })).toHaveCount(
		0,
	);
	await expect(table.getByRole('link', { exact: true, name: 'Sommerfest' })).toBeVisible();

	// Deleting on the template's own page returns to the list and says so there.
	await table.getByRole('link', { exact: true, name: 'Rundbrief' }).click();
	await expect(
		eva.getByRole('heading', { exact: true, level: 1, name: 'Rundbrief' }),
	).toBeVisible();
	await eva.getByRole('button', { exact: true, name: 'Löschen' }).click();
	await eva.getByRole('button', { name: 'Endgültig löschen' }).click();
	await expect(eva).toHaveURL(/\/templates$/u);
	await expect(eva.getByText('Die Vorlage „Rundbrief“ wurde gelöscht.')).toBeVisible();
	await expect(table.getByRole('link', { exact: true, name: 'Rundbrief' })).toHaveCount(0);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an editor uploads, renames and deletes an image', async () => {
	await eva.goto('/images');
	await expect(eva).toHaveTitle('Bilder – Vereinsbote');
	const upload = eva.getByRole('button', { name: 'Bild auswählen' });
	await expect(upload).toBeEnabled();
	await choose(eva, { label: 'Bereich', option: 'Veranstaltungen' });
	await expectNoA11yViolations(eva);
	const chooser = eva.waitForEvent('filechooser');
	await upload.click();
	const fileChooser = await chooser;
	await fileChooser.setFiles({
		buffer: await solidPng(IMAGE_WIDTH, IMAGE_HEIGHT),
		mimeType: 'image/png',
		name: 'wappen.png',
	});
	await expect(eva.getByText(/Das Bild wurde hochgeladen\./u)).toBeVisible();
	await expect(eva.getByText('In keiner Vorlage genutzt')).toBeVisible();
	await expectNoA11yViolations(eva);

	// A picture without transparency is stored as a JPEG, so the name may end in .jpg.
	await eva.getByRole('button', { name: /^wappen\.(?:jpg|png) umbenennen$/u }).click();
	await eva.getByLabel('Neuer Name').fill('Vereinswappen');
	await eva.getByRole('button', { name: 'Speichern' }).click();
	await expect(eva.getByText('Das Bild heißt jetzt „Vereinswappen“.')).toBeVisible();

	await eva.getByRole('button', { name: 'Vereinswappen löschen' }).click();
	await expect(eva.getByRole('dialog', { name: '„Vereinswappen“ löschen?' })).toBeVisible();
	await expectNoA11yViolations(eva);
	await eva.getByRole('button', { name: 'Endgültig löschen' }).click();
	await expect(eva.getByText('Das Bild „Vereinswappen“ wurde gelöscht.')).toBeVisible();
	await expect(eva.getByText('In diesem Bereich gibt es noch keine Bilder.')).toBeVisible();
});
