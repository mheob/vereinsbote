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

/** The title of the preview frame in the editor; the mail in it is the club's own design. */
const PREVIEW_FRAME = 'iframe[title="Vorschau der Mail"]';
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
	// The editor opens with the starter's blocks.
	await expect(eva.getByRole('grid', { name: 'Bausteine' }).getByRole('row')).toHaveCount(5);
	await expect(
		eva.getByRole('row', { name: 'Überschrift: Einladung zu [Veranstaltung]' }),
	).toBeVisible();
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);

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
	// The editor is read-only: no saving, no adding, the preview stays.
	await expect(rita.getByText('Du kannst diese Vorlage nur ansehen.')).toBeVisible();
	await expect(rita.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
	await expect(rita.getByRole('button', { name: 'Baustein hinzufügen' })).toHaveCount(0);
	await expect(rita.getByRole('grid', { name: 'Bausteine' }).getByRole('row')).toHaveCount(5);
	await expect(
		rita.frameLocator('iframe[title="Vorschau der Mail"]').getByText('Liebe Anna'),
	).toBeVisible();
	await expectNoA11yViolations(rita, [PREVIEW_FRAME]);

	// Creating needs `edit` somewhere: Rita only reads.
	await rita.goto('/templates/new');
	await expect(
		rita.getByText('Um Vorlagen anzulegen, brauchst du die Stufe „Bearbeiten“'),
	).toBeVisible();
	await expect(rita.getByRole('button', { name: 'Vorlage anlegen' })).toHaveCount(0);
	await expectNoA11yViolations(rita);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the reader sees it
test('a reader of one area who edits another can copy its templates', async () => {
	await admin.goto('/admin/users');
	await grant(admin, { area: 'Finanzen', level: 'Bearbeiten', user: 'Rita' });
	await rita.goto('/templates');
	const table = rita.getByRole('grid', { name: 'Vorlagen' });
	await expect(table.getByRole('link', { exact: true, name: 'Sommerfest' })).toBeVisible();
	// Copying needs `read` in the source and `edit` in the target; changing needs `edit` in the source.
	await expect(rita.getByRole('button', { name: 'Sommerfest duplizieren' })).toBeVisible();
	await expect(rita.getByRole('button', { name: /löschen/u })).toHaveCount(0);
	await expect(rita.getByRole('link', { name: /bearbeiten/u })).toHaveCount(0);
	await rita.getByRole('button', { name: 'Sommerfest duplizieren' }).click();
	const dialog = rita.getByRole('dialog', { name: 'Sommerfest duplizieren' });
	await expect(dialog.getByRole('button', { name: /Zielbereich/u })).toContainText('Finanzen');
	await dialog.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(dialog).toHaveCount(0);
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

/**
 * Waits until a live region says a text. The page has more than one (the preview says when it is
 * ready), so the region is found by its text.
 *
 * @param page The page.
 * @param text The announcement.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function expectAnnounced(page: Page, text: string): Promise<void> {
	await expect(page.getByRole('status').filter({ hasText: text })).toHaveText(text);
}

/**
 * Opens a template of the list in the editor and waits until the editor is hydrated.
 *
 * @param page The page of the user.
 * @param name The name of the template.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function openEditor(page: Page, name: string): Promise<void> {
	await page.goto('/templates');
	await page
		.getByRole('grid', { name: 'Vorlagen' })
		.getByRole('link', { exact: true, name })
		.click();
	await expect(page.getByRole('heading', { exact: true, level: 1, name })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();
}

/**
 * Adds a block through the menu „Baustein hinzufügen“, with the keyboard.
 *
 * @param page The page of the editor.
 * @param type The name of the block type in the menu.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see openEditor
async function addBlock(page: Page, type: string): Promise<void> {
	await page.getByRole('button', { name: 'Baustein hinzufügen' }).press('Enter');
	await expect(page.getByRole('menu')).toBeVisible();
	await page.getByRole('menuitem', { exact: true, name: type }).press('Enter');
}

/**
 * Inserts a placeholder through its dialog, with the keyboard.
 *
 * @param page The page of the editor.
 * @param name The name of the placeholder.
 * @param missing What happens when the value is missing: „Pflicht“, „Leer lassen“ or „Text“.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see openEditor
async function insertPlaceholder(page: Page, name: string, missing = 'Pflicht'): Promise<void> {
	await page.getByRole('button', { name: 'Platzhalter einfügen' }).press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Platzhalter einfügen' });
	await dialog.getByRole('option', { exact: true, name }).press('Enter');
	await dialog.getByRole('radio', { exact: true, name: missing }).press('Space');
	await dialog.getByRole('button', { name: 'Einfügen' }).press('Enter');
	await expect(dialog).toHaveCount(0);
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an editor builds a template with the keyboard only', async () => {
	test.slow();
	await openEditor(eva, 'Sommerfest');
	const blocks = eva.getByRole('grid', { name: 'Bausteine' });
	await expect(blocks.getByRole('row')).toHaveCount(5);
	await expect(eva.getByText('Ungespeicherte Änderungen')).toHaveCount(0);

	// A text block at the end, with a placeholder.
	await addBlock(eva, 'Text');
	await expectAnnounced(eva, 'Text an Position 6 von 6 hinzugefügt');
	await expect(eva.getByText('Ungespeicherte Änderungen')).toBeVisible();
	const text = eva.getByRole('textbox', { exact: true, name: 'Text' });
	await text.press('End');
	await eva.keyboard.type('Hallo ');
	// Alt+F10 moves to the toolbar, Escape back to the text.
	await eva.keyboard.press('Alt+F10');
	await expect(eva.getByRole('button', { name: 'Fett' })).toBeFocused();
	await eva.keyboard.press('Escape');
	await expect(text).toBeFocused();
	// The birth date belongs to another area: the dialog does not offer it.
	await eva.getByRole('button', { name: 'Platzhalter einfügen' }).press('Enter');
	const placeholders = eva.getByRole('dialog', { name: 'Platzhalter einfügen' });
	await expect(placeholders.getByRole('option', { name: 'Vorname' })).toBeVisible();
	await expect(placeholders.getByRole('option', { name: 'Geburtsdatum' })).toHaveCount(0);
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);
	await eva.keyboard.press('Escape');
	await insertPlaceholder(eva, 'Vorname');
	await expect(text).toContainText('Hallo');
	await expect(text.locator('[data-placeholder]')).toHaveText(/Vorname$/u);

	// Keyboard drag and drop to the first position, announced in the live region.
	const row = blocks.getByRole('row', { name: /^Text: Hallo/u });
	await row.getByRole('button', { name: /ziehen$/u }).press('Enter');
	// The drop targets are focusable once the drag has started; Home goes to the first one.
	await expect(eva.locator(':focus')).toHaveAccessibleName(/einfügen$/u);
	await eva.keyboard.press('Home');
	await expect(eva.locator(':focus')).toHaveAccessibleName(/^Vor Überschrift/u);
	await eva.keyboard.press('Enter');
	await expectAnnounced(eva, 'Text an Position 1 von 6 verschoben');
	await expect(blocks.getByRole('row').first()).toHaveAccessibleName(/^Text: Hallo/u);
	await expect(eva.locator(':focus')).toHaveAccessibleName(/^Text: Hallo/u);
	// The preview shows the new order. React Aria settles the focus a moment after a drop, so a
	// user acts after that; the preview (which follows the change after its delay) tells when.
	await expect(eva.frameLocator(PREVIEW_FRAME).locator('body')).toHaveText(
		/Hallo Anna[\s\S]*Einladung zu/u,
	);

	// An image without an alt text is refused, with the focus at the field.
	await addBlock(eva, 'Bild');
	await expectAnnounced(eva, 'Bild an Position 2 von 7 hinzugefügt');
	await eva.getByRole('button', { name: 'Bild aus der Sammlung wählen' }).press('Enter');
	const picker = eva.getByRole('dialog', { name: 'Bild auswählen' });
	const chooser = eva.waitForEvent('filechooser');
	await picker.getByRole('button', { name: 'Bild auswählen' }).press('Enter');
	const fileChooser = await chooser;
	await fileChooser.setFiles({
		buffer: await solidPng(IMAGE_WIDTH, IMAGE_HEIGHT),
		mimeType: 'image/png',
		name: 'wappen.png',
	});
	await expect(picker.getByRole('row')).toHaveCount(1);
	const use = picker.getByRole('button', { name: 'Dieses Bild verwenden' });
	await expect(use).toBeEnabled();
	await use.press('Enter');
	await expect(picker).toHaveCount(0);
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expect(eva.getByRole('alert')).toHaveText(
		'Die Vorlage wurde nicht gespeichert. Bitte prüfe die markierten Stellen.',
	);
	const alt = eva.getByRole('textbox', { name: 'Alternativtext' });
	await expect(alt).toBeFocused();
	await expect(alt).toHaveAttribute('aria-invalid', 'true');
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);
	await alt.fill('Vereinswappen');
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expectAnnounced(eva, 'Die Vorlage ist gespeichert.');
	await expect(eva.getByText('Ungespeicherte Änderungen')).toHaveCount(0);

	// The preview shows the sample contact; everything is still there after a reload.
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Liebe Anna')).toBeVisible();
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Hallo Anna')).toBeVisible();
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);
	await eva.reload();
	await expect(blocks.getByRole('row')).toHaveCount(7);
	await expect(blocks.getByRole('row').first()).toHaveAccessibleName(/^Text: Hallo/u);
	await expect(blocks.getByRole('row').nth(1)).toHaveAccessibleName('Bild: Vereinswappen');
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an image that a template shows cannot be deleted', async () => {
	await eva.goto('/images');
	await expect(eva.getByRole('button', { name: 'Bild auswählen' })).toBeEnabled();
	await choose(eva, { label: 'Bereich', option: 'Veranstaltungen' });
	// The keyboard test left the image in use by „Sommerfest“.
	await eva.getByRole('button', { name: /^wappen\.(?:jpg|png) löschen$/u }).click();
	const dialog = eva.getByRole('dialog', { name: /^„wappen\.(?:jpg|png)“ löschen\?$/u });
	await expect(dialog).toContainText('Sommerfest');
	await expect(dialog.getByRole('button', { name: 'Endgültig löschen' })).toHaveCount(0);
	await expectNoA11yViolations(eva);
	await dialog.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(dialog).toHaveCount(0);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an editor is warned before leaving with unsaved changes', async () => {
	await openEditor(eva, 'Sommerfest');
	await eva.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	await eva.getByRole('textbox', { name: 'Vorschautext' }).fill('Am Samstag im Vereinsheim');
	await eva.getByRole('link', { name: 'Zurück zu den Vorlagen' }).press('Enter');
	const leave = eva.getByRole('alertdialog', { name: 'Änderungen verwerfen?' });
	await expect(leave).toBeVisible();
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);
	await leave.getByRole('button', { name: 'Weiter bearbeiten' }).press('Enter');
	await expect(leave).toHaveCount(0);
	await expect(eva).toHaveURL(/\/templates\/[\w-]{36}$/u);
	await expect(eva.getByRole('textbox', { name: 'Vorschautext' })).toHaveText(
		'Am Samstag im Vereinsheim',
	);
	await eva.getByRole('link', { name: 'Zurück zu den Vorlagen' }).press('Enter');
	await eva.getByRole('button', { name: 'Verwerfen und verlassen' }).press('Enter');
	await expect(eva).toHaveURL(/\/templates$/u);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('a block in a column opens its form beside the columns form', async () => {
	await openEditor(eva, 'Sommerfest');
	await addBlock(eva, 'Zwei Spalten');
	const left = eva.getByRole('grid', { name: 'Linke Spalte' });
	await expect(left).toBeVisible();
	await eva.getByRole('button', { name: 'Baustein links hinzufügen' }).press('Enter');
	await expect(eva.getByRole('menu')).toBeVisible();
	await eva.getByRole('menuitem', { exact: true, name: 'Überschrift' }).press('Enter');
	// The form of the new block shows, and the columns and their list stay.
	await expect(left.getByRole('row')).toHaveCount(1);
	await expect(
		eva.getByRole('heading', { level: 3, name: 'Überschrift bearbeiten' }),
	).toBeVisible();
	await expect(
		eva.getByRole('heading', { level: 3, name: 'Zwei Spalten bearbeiten' }),
	).toBeVisible();
	const heading = eva.getByRole('textbox', { exact: true, name: 'Text' });
	await heading.press('End');
	await eva.keyboard.type('Aus der Spalte');
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Aus der Spalte')).toBeVisible();
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expectAnnounced(eva, 'Die Vorlage ist gespeichert.');
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('a field whose editor does not load shows the error at the field and loads again', async () => {
	// The chunk of the one-line fields fails, as on a broken connection or after a deploy.
	const chunk = /\/assets\/inline-field-[\w-]+\.js$/u;
	await eva.route(chunk, async (route) => route.abort('connectionfailed'));
	await openEditor(eva, 'Sommerfest');
	await eva.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	const preheader = eva.getByRole('group', { name: 'Vorschautext' });
	await expect(preheader.getByRole('alert')).toHaveText(
		'Das Feld konnte nicht geladen werden. Prüfe die Verbindung und lade es erneut; hilft das nicht, lade die Seite neu.',
	);
	// Only the field fails, not the editor around it.
	await expect(
		eva.getByRole('heading', { exact: true, level: 1, name: 'Sommerfest' }),
	).toBeVisible();
	await expect(eva.getByRole('button', { name: 'Speichern' })).toBeEnabled();
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);

	await eva.unroute(chunk);
	await preheader.getByRole('button', { name: 'Feld erneut laden' }).press('Enter');
	await expect(eva.getByRole('textbox', { name: 'Vorschautext' })).toBeEditable();
	await expect(preheader).toHaveCount(0);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it in two tabs
test('two tabs: the second save is refused', async () => {
	await openEditor(eva, 'Sommerfest');
	const second = await eva.context().newPage();
	await openEditor(second, 'Sommerfest');

	await eva.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	await eva.getByRole('textbox', { name: 'Vorschautext' }).fill('Am Samstag im Vereinsheim');
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expectAnnounced(eva, 'Die Vorlage ist gespeichert.');

	await second.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	await second.getByRole('textbox', { name: 'Vorschautext' }).fill('Am Sonntag');
	await second.getByRole('button', { name: 'Speichern' }).press('Enter');
	const changed = second.getByRole('alertdialog', { name: 'Vorlage inzwischen geändert' });
	await expect(changed).toContainText(
		'Die Vorlage wurde inzwischen geändert. Neu laden verwirft deine Änderungen.',
	);
	await expectNoA11yViolations(second, [PREVIEW_FRAME]);
	await changed.getByRole('button', { name: 'Neu laden' }).press('Enter');
	await expect(second.getByRole('button', { name: 'Speichern' })).toBeEnabled();
	await second.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	await expect(second.getByRole('textbox', { name: 'Vorschautext' })).toHaveText(
		'Am Samstag im Vereinsheim',
	);
	await second.close();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('duplicating a template that uses the birth date into an area that may not see it is refused with the placeholder named', async () => {
	// „Finanzen“ sees the members' birth date (project `contacts`), „Veranstaltungen“ does not.
	await eva.goto('/templates/new');
	await expect(eva.getByRole('button', { name: 'Vorlage anlegen' })).toBeEnabled();
	await choose(eva, { label: 'Bereich', option: 'Finanzen' });
	await eva.getByLabel('Name', { exact: true }).fill('Geburtstagsgruß');
	await eva.getByLabel('Betreff').fill('Alles Gute');
	await eva.getByRole('button', { name: 'Vorlage anlegen' }).click();
	await expect(
		eva.getByRole('heading', { exact: true, level: 1, name: 'Geburtstagsgruß' }),
	).toBeVisible();
	await expect(eva.getByRole('button', { name: 'Speichern' })).toBeEnabled();
	await addBlock(eva, 'Text');
	await eva.getByRole('textbox', { exact: true, name: 'Text' }).press('End');
	await eva.keyboard.type('Dein Geburtstag: ');
	await insertPlaceholder(eva, 'Geburtsdatum', 'Leer lassen');
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expectAnnounced(eva, 'Die Vorlage ist gespeichert.');

	await eva.goto('/templates');
	await eva.getByRole('button', { name: 'Geburtstagsgruß duplizieren' }).click();
	const dialog = eva.getByRole('dialog', { name: 'Geburtstagsgruß duplizieren' });
	await choose(eva, { label: 'Zielbereich', option: 'Veranstaltungen', within: dialog });
	await dialog.getByRole('button', { name: 'Duplizieren' }).click();
	await expect(dialog.getByRole('alert')).toHaveText(
		'Diese Platzhalter sind im Zielbereich nicht erlaubt: Geburtsdatum',
	);
	await expect(eva).toHaveURL(/\/templates$/u);
	await dialog.getByRole('button', { name: 'Abbrechen' }).click();
});

/**
 * Picks a real contact in the preview: switches to „Echter Kontakt“, searches the name and picks
 * the only hit. The search goes by POST, so the page's address never holds the term.
 *
 * @param page The page of the editor.
 * @param name The full name of the contact.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see openEditor
async function previewContact(page: Page, name: string): Promise<void> {
	await page.getByRole('radio', { name: 'Echter Kontakt' }).click();
	await expect(page.getByText('Wähle einen Kontakt, um die Vorschau zu sehen.')).toBeVisible();
	const search = page.getByRole('combobox', { name: 'Kontakt suchen' });
	await search.fill(name);
	await expect(search).toHaveValue(name);
	// Before the search filtered, ten contacts are listed; wait for the one with this name.
	const option = page.getByRole('option', { name });
	await expect(option).toHaveCount(1);
	await option.click();
	await expect(page).not.toHaveURL(new RegExp(name.split(' ')[0] ?? '', 'u'));
	await expectAnnounced(page, `Die Vorschau zeigt jetzt ${name}.`);
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('the preview greets a real contact and delivers no value of another area', async () => {
	await openEditor(eva, 'Sommerfest');
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Liebe Anna')).toBeVisible();
	// A sample of another gender, chosen from the list.
	await eva.getByRole('button', { name: /Beispielkontakt/u }).click();
	await eva.getByRole('option', { name: 'Mitglied, männlich' }).click();
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Lieber Bernd')).toBeVisible();
	await eva.getByRole('button', { name: /Beispielkontakt/u }).click();
	await eva.getByRole('option', { name: 'Mitglied, weiblich' }).click();

	// A real contact of the contacts project: its values come from the server, by POST.
	const loaded = eva.waitForResponse(async (response) => {
		if (response.request().method() !== 'POST') return false;
		const text = await response.text().catch(() => '');
		return text.includes('contact.firstName');
	});
	await previewContact(eva, 'Ben Bauer');
	const response = await loaded;
	const body = await response.text();
	expect(body).toContain('Ben');
	// „Veranstaltungen“ does not get the birth date, although Eva may see it elsewhere.
	expect(body).not.toContain('birthDate');
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Lieber Ben')).toBeVisible();
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);

	// Back to the sample.
	await eva.getByRole('radio', { name: 'Beispiel' }).click();
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Liebe Anna')).toBeVisible();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('the preview names what a real contact lacks', async () => {
	await openEditor(eva, 'Geburtstagsgruß');
	await addBlock(eva, 'Text');
	await eva.getByRole('textbox', { exact: true, name: 'Text' }).press('End');
	await eva.keyboard.type('Dein Ort: ');
	await insertPlaceholder(eva, 'Ort');
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expectAnnounced(eva, 'Die Vorlage ist gespeichert.');
	// The sample has a city.
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Dein Ort: Beispielstadt')).toBeVisible();

	// The imported members have none, and the placeholder has no replacement text.
	await previewContact(eva, 'Ben Bauer');
	await expect(eva.getByText('Für diesen Kontakt fehlt: Ort')).toBeVisible();
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);
});

/** One byte above the 500 KB an import takes. */
const OVER_LIMIT_BYTES = 512_001;
/** The title of the preview frame of an import. */
const IMPORT_FRAME = 'iframe[title="Vorschau des importierten HTML"]';

/** A mail from a text editor with a script, an event handler and a link that runs script. */
const DIRTY_MAIL = [
	'<html lang="de"><body>',
	'<h1>Rundbrief im Herbst</h1>',
	'<p onclick="alert(1)">Hallo {{salutation}},</p>',
	'<script>document.title = "ausgeführt";</script>',
	'<p><a href="javascript:alert(2)">Hier klicken</a></p>',
	'</body></html>',
].join('');

/** HTML as Word saves it, in Windows-1252 (the test writes it as Latin-1, which is the same here). */
const WORD_HTML = [
	'<html><head>',
	'<meta http-equiv=Content-Type content="text/html; charset=windows-1252">',
	'</head><body><p>Grüße vom Sommerfest, Straße und Café inklusive</p></body></html>',
].join('');

/**
 * Chooses a file in the import: the hidden file input of React Aria's file trigger.
 *
 * @param page The page with the import.
 * @param file The name and the text of the file.
 * @param file.name The name.
 * @param file.text The text; its bytes are the size.
 */
async function chooseHtmlFile(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
	page: Page,
	file: Readonly<{ name: string; text: string }>,
): Promise<void> {
	await page
		.locator('input[type="file"]')
		.setInputFiles({ buffer: Buffer.from(file.text), mimeType: 'text/html', name: file.name });
	await expect(page.getByLabel('HTML', { exact: true })).toHaveValue(file.text);
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an editor imports html with a script and sees it removed', async () => {
	test.slow();
	await eva.goto('/templates/new');
	await expect(eva.getByRole('button', { name: 'Vorlage anlegen' })).toBeEnabled();
	await choose(eva, { label: 'Bereich', option: 'Veranstaltungen' });
	await eva.getByText('HTML importieren', { exact: true }).click();
	await expect(eva.getByRole('radio', { name: 'HTML importieren' })).toBeChecked();
	await expect(eva.getByRole('button', { name: 'Vorlage anlegen' })).toHaveCount(0);
	await eva.getByLabel('Name', { exact: true }).fill('Rundbrief');
	await eva.getByLabel('Betreff').fill('Neues aus dem Verein');
	await expectNoA11yViolations(eva);

	// More than 500 KB is refused in the browser, before anything is sent.
	await eva.locator('input[type="file"]').setInputFiles({
		buffer: Buffer.alloc(OVER_LIMIT_BYTES, 'a'),
		mimeType: 'text/html',
		name: 'zu-gross.html',
	});
	await expect(eva.getByText('Das HTML ist zu groß (höchstens 500 KB).')).toBeVisible();

	// Word and older Outlook versions save HTML in Windows-1252: the umlauts stay umlauts.
	await eva.locator('input[type="file"]').setInputFiles({
		buffer: Buffer.from(WORD_HTML, 'latin1'),
		mimeType: 'text/html',
		name: 'word.htm',
	});
	await expect(eva.getByLabel('HTML', { exact: true })).toHaveValue(WORD_HTML);

	await chooseHtmlFile(eva, { name: 'rundbrief.html', text: DIRTY_MAIL });
	await expect(eva.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
	await eva.getByRole('button', { name: 'Prüfen' }).click();
	await expectAnnounced(eva, 'Das HTML wurde geprüft. Du kannst es übernehmen.');
	await expect(eva.getByRole('heading', { level: 3, name: 'Entfernt' })).toBeVisible();
	await expect(eva.getByText('Skripte: 1')).toBeVisible();
	await expect(eva.getByText('Ereignis-Attribute wie onclick: 1')).toBeVisible();
	await expect(
		eva.getByText('Links und Bilder mit unsicherer Adresse, zum Beispiel javascript: 1'),
	).toBeVisible();
	await expect(eva.getByRole('heading', { level: 3, name: 'Warnungen' })).toBeVisible();
	await expect(
		eva.getByText('Der Link-Text „Hier klicken“ sagt ohne seine Umgebung wenig.'),
	).toBeVisible();

	// The preview shows the cleaned mail with the sample contact; the script did not run.
	const preview = eva.frameLocator(IMPORT_FRAME);
	await expect(preview.getByRole('heading', { name: 'Rundbrief im Herbst' })).toBeVisible();
	await expect(preview.getByText('Hallo Liebe Anna,')).toBeVisible();
	await expect(preview.locator('script')).toHaveCount(0);
	await expect(preview.locator('[onclick]')).toHaveCount(0);
	// The link text stays, the address that runs script does not.
	await expect(preview.getByText('Hier klicken')).toBeVisible();
	await expect(preview.locator('a[href*="javascript"]')).toHaveCount(0);
	await expectNoA11yViolations(eva, [IMPORT_FRAME]);

	await eva.getByRole('button', { name: 'Übernehmen' }).click();
	await expect(eva).toHaveURL(/\/templates\/[\w-]{36}$/u);
	await expect(
		eva.getByRole('heading', { exact: true, level: 1, name: 'Rundbrief' }),
	).toBeVisible();
	await expect(eva.getByText('Diese Vorlage besteht aus importiertem HTML.')).toBeVisible();
	await expect(eva.getByRole('button', { name: 'Speichern' })).toBeEnabled();
	await expect(eva.getByRole('heading', { level: 2, name: 'Neues HTML einfügen' })).toBeVisible();
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Rundbrief im Herbst')).toBeVisible();
	await expect(eva.frameLocator(PREVIEW_FRAME).locator('script')).toHaveCount(0);
	await expectNoA11yViolations(eva, [PREVIEW_FRAME, IMPORT_FRAME]);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin and the editor see it
test('an admin imports a global layout and an editor uses it', async () => {
	test.slow();
	await admin.goto('/admin/layouts');
	await expect(admin).toHaveTitle('Layouts – Vereinsbote');
	await expect(
		admin.getByRole('heading', { exact: true, level: 1, name: 'Layouts' }),
	).toBeVisible();
	await expect(admin.getByText('Es gibt noch keine Layouts.')).toBeVisible();
	await expect(
		admin.getByRole('navigation', { name: 'Verwaltung' }).getByRole('link', { name: 'Layouts' }),
	).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Prüfen' })).toBeEnabled();
	await expectNoA11yViolations(admin);

	await admin.getByLabel('Name', { exact: true }).fill('Vereinsrahmen');
	await chooseHtmlFile(admin, {
		name: 'rahmen.html',
		text: '<html lang="de"><body><div><p>Rahmen-Kopf von {{brand.name}}</p>{{content}}<p>Rahmen-Fuß</p></div></body></html>',
	});
	await admin.getByRole('button', { name: 'Prüfen' }).click();
	await expectAnnounced(admin, 'Das HTML wurde geprüft. Du kannst es übernehmen.');
	await expect(admin.frameLocator(IMPORT_FRAME).getByText('Rahmen-Kopf von')).toBeVisible();
	await expect(
		admin.frameLocator(IMPORT_FRAME).getByText('Einladung zum Sommerfest'),
	).toBeVisible();
	await expectNoA11yViolations(admin, [IMPORT_FRAME]);
	await admin.getByRole('button', { name: 'Übernehmen' }).click();
	await expectAnnounced(admin, 'Das Layout „Vereinsrahmen“ wurde angelegt.');
	const table = admin.getByRole('grid', { name: 'Alle Layouts' });
	await expect(table.getByRole('link', { exact: true, name: 'Vereinsrahmen' })).toBeVisible();
	await expect(table.getByText('nicht genutzt')).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Vereinsrahmen löschen' })).toBeEnabled();

	// The editor chooses it in the settings of a template; the preview shows the frame.
	await openEditor(eva, 'Sommerfest');
	await eva.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	await eva.getByRole('button', { name: / Layout$/u }).click();
	await eva.getByRole('option', { name: 'Vereinsrahmen' }).click();
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Rahmen-Fuß')).toBeVisible();
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expectAnnounced(eva, 'Die Vorlage ist gespeichert.');

	// A layout in use cannot be deleted, and the list says how often it is used.
	await admin.goto('/admin/layouts');
	await expect(admin.getByText('genutzt in 1 Vorlage')).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Vereinsrahmen löschen' })).toBeDisabled();

	// Its own page replaces the HTML.
	await admin.getByRole('link', { name: 'HTML von Vereinsrahmen ersetzen' }).click();
	await expect(admin).toHaveTitle('Layout – Vereinsbote');
	await expect(
		admin.getByRole('heading', { exact: true, level: 1, name: 'Vereinsrahmen' }),
	).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Prüfen' })).toBeEnabled();
	await chooseHtmlFile(admin, {
		name: 'rahmen2.html',
		text: '<html lang="de"><body><div>{{content}}<p>Neuer Rahmen-Fuß</p></div></body></html>',
	});
	await admin.getByRole('button', { name: 'Prüfen' }).click();
	await expectAnnounced(admin, 'Das HTML wurde geprüft. Du kannst es übernehmen.');
	await expectNoA11yViolations(admin, [IMPORT_FRAME]);
	await admin.getByRole('button', { name: 'Übernehmen' }).click();
	await expectAnnounced(admin, 'Das Layout wurde ersetzt.');
	// The form starts over: one import, empty.
	await expect(admin.getByRole('button', { name: 'Prüfen' })).toHaveCount(1);
	await expect(admin.getByLabel('HTML', { exact: true })).toHaveValue('');
	await openEditor(eva, 'Sommerfest');
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Neuer Rahmen-Fuß')).toBeVisible();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin sees it
test('a layout without {{content}} is refused', async () => {
	await admin.goto('/admin/layouts');
	await expect(admin.getByRole('button', { name: 'Prüfen' })).toBeEnabled();
	await admin.getByLabel('Name', { exact: true }).fill('Ohne Inhalt');
	await chooseHtmlFile(admin, {
		name: 'leer.html',
		text: '<html lang="de"><body><p>Nur ein Rahmen</p></body></html>',
	});
	await admin.getByRole('button', { name: 'Prüfen' }).click();
	await expect(admin.getByRole('alert').filter({ hasText: 'abgelehnt' })).toBeVisible();
	await expect(admin.getByRole('heading', { level: 3, name: 'Abgelehnt' })).toBeVisible();
	await expect(
		admin.getByText(
			'Das Layout braucht den Platzhalter „Inhalt“ genau einmal, als eigenen Textabschnitt.',
		),
	).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
	await expect(admin.frameLocator(IMPORT_FRAME).locator('body')).toHaveCount(0);
	await expectNoA11yViolations(admin);
	const table = admin.getByRole('grid', { name: 'Alle Layouts' });
	await expect(table.getByRole('link', { name: 'Ohne Inhalt' })).toHaveCount(0);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an editor changes the settings of an html template and replaces its html afterwards', async () => {
	test.slow();
	await openEditor(eva, 'Rundbrief');
	await eva.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	await eva.getByRole('textbox', { name: 'Betreff' }).fill('Neues aus dem Verein im Frühling');
	await eva.getByRole('radio', { name: 'Sie' }).press('Space');
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expectAnnounced(eva, 'Die Vorlage ist gespeichert.');
	await expectNoA11yViolations(eva, [PREVIEW_FRAME, IMPORT_FRAME]);

	// The HTML is replaced at once, without a reload: the import knows the version just saved.
	await eva
		.getByLabel('HTML', { exact: true })
		.fill('<html lang="de"><body><h1>Rundbrief im Frühling</h1></body></html>');
	await eva.getByRole('button', { name: 'Prüfen' }).click();
	await expectAnnounced(eva, 'Das HTML wurde geprüft. Du kannst es übernehmen.');
	await eva.getByRole('button', { name: 'Übernehmen' }).click();
	await expectAnnounced(eva, 'Das HTML wurde ersetzt.');
	await expect(eva.getByRole('alertdialog')).toHaveCount(0);
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Rundbrief im Frühling')).toBeVisible();

	// Both settings are still there after the replacement and after opening it anew.
	await openEditor(eva, 'Rundbrief');
	await eva.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	await expect(eva.getByRole('textbox', { name: 'Betreff' })).toHaveText(
		'Neues aus dem Verein im Frühling',
	);
	await expect(eva.getByRole('radio', { name: 'Sie' })).toBeChecked();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the editor sees it
test('an editor replaces the html of a template and imports an own layout', async () => {
	test.slow();
	// An HTML template is opened from the list; its import waits below the settings.
	await eva.goto('/templates');
	await eva
		.getByRole('grid', { name: 'Vorlagen' })
		.getByRole('link', { exact: true, name: 'Rundbrief' })
		.click();
	await expect(
		eva.getByRole('heading', { exact: true, level: 1, name: 'Rundbrief' }),
	).toBeVisible();
	await expect(eva.getByRole('button', { name: 'Prüfen' })).toBeEnabled();
	await chooseHtmlFile(eva, {
		name: 'neu.html',
		text: '<html lang="de"><body><h1>Rundbrief im Winter</h1><p>{{contact.birthDate}}</p></body></html>',
	});
	await eva.getByRole('button', { name: 'Prüfen' }).click();
	// A placeholder the area does not see is refused with its own message; nothing is replaced.
	await expect(eva.getByRole('heading', { level: 3, name: 'Abgelehnt' })).toBeVisible();
	await expect(
		eva.getByText('Der Platzhalter „Geburtsdatum“ ist in diesem Bereich nicht erlaubt.'),
	).toBeVisible();
	await expect(eva.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();

	await eva
		.getByLabel('HTML', { exact: true })
		.fill('<html lang="de"><body><h1>Rundbrief im Winter</h1></body></html>');
	await eva.getByRole('button', { name: 'Prüfen' }).click();
	await expectAnnounced(eva, 'Das HTML wurde geprüft. Du kannst es übernehmen.');
	await eva.getByRole('button', { name: 'Übernehmen' }).click();
	await expectAnnounced(eva, 'Das HTML wurde ersetzt.');
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Rundbrief im Winter')).toBeVisible();

	// An own layout for a template of blocks: checked, taken over, saved with the template.
	await openEditor(eva, 'Geburtstagsgruß');
	await eva.getByRole('button', { name: 'Einstellungen' }).press('Enter');
	await eva.getByRole('button', { name: 'Eigenes Layout importieren' }).press('Enter');
	await eva
		.getByLabel('HTML', { exact: true })
		.fill('<html lang="de"><body><div><p>Eigener Kopf</p>{{content}}</div></body></html>');
	await eva.getByRole('button', { name: 'Prüfen' }).click();
	await expectAnnounced(eva, 'Das HTML wurde geprüft. Du kannst es übernehmen.');
	await eva.getByRole('button', { name: 'Übernehmen' }).click();
	await expectAnnounced(
		eva,
		'Das Layout wurde übernommen. Speichere die Vorlage, um es zu behalten.',
	);
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Eigener Kopf')).toBeVisible();
	await eva.getByRole('button', { name: 'Speichern' }).press('Enter');
	await expectAnnounced(eva, 'Die Vorlage ist gespeichert.');
	await openEditor(eva, 'Geburtstagsgruß');
	await expect(eva.frameLocator(PREVIEW_FRAME).getByText('Eigener Kopf')).toBeVisible();
});
