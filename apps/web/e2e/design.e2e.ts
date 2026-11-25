import type { Locator, Page } from '@playwright/test';

import { expectNoA11yViolations } from './helpers/a11y';
import { deleteAllMessages } from './helpers/mailpit';
import { signIn } from './helpers/sign-in';
import { expect, test } from './helpers/test';

/*
 * The design of the mails, as the admin sees it. Runs after the project `fundament`, which set the
 * club up (admin@verein.test). The tests build on each other and share the pages of the admin.
 */
test.describe.configure({ mode: 'serial' });

// oxlint-disable-next-line init-declarations -- signed in once in `beforeAll`, shared by the serial tests
let admin: Page;

/** The server sends one sign-in link per address and minute (`LOGIN_LINK_WINDOW_SECONDS`). */
const LINK_WINDOW_MS = 15_000;
const SIGN_IN_ATTEMPTS = 5;
const BEFORE_ALL_TIMEOUT_MS = 120_000;

/**
 * Signs the admin in. The project `contacts` signed the same address in shortly before; a request
 * inside the minute sends no mail, so the sign-in waits and asks again.
 *
 * @param page The page of the admin's context.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function signInAdmin(page: Page): Promise<void> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- each attempt waits for the previous one
			await signIn(page, 'admin@verein.test');
			return;
		} catch (error) {
			if (attempt >= SIGN_IN_ATTEMPTS) throw error;
			// oxlint-disable-next-line no-await-in-loop -- see above
			await page.waitForTimeout(LINK_WINDOW_MS);
		}
	}
}

test.beforeAll(async ({ browser }) => {
	test.setTimeout(BEFORE_ALL_TIMEOUT_MS);
	// An address of its own for the proxy header: `contacts` used the sign-in link requests that the
	// server allows per address and minute.
	const context = await browser.newContext({
		extraHTTPHeaders: { 'x-forwarded-for': '127.0.0.2' },
		locale: 'de-DE',
	});
	admin = await context.newPage();
	// Without older mails, the newest sign-in link is certainly the one of this request.
	await deleteAllMessages();
	await signInAdmin(admin);
});

test.afterAll(async () => {
	await admin.context().close();
});

const HTTP_OK = 200;

/** A logo as the author of a club might have it: an SVG, built here as text. */
const LOGO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="96"><rect width="240" height="96" fill="#1d4ed8"/></svg>';

const FRAME_TITLE = 'Vorschau einer Mail mit dem CD';

/**
 * Whether an image of the preview frame has loaded.
 *
 * @param image The image in the frame.
 * @returns True once the browser decoded it.
 */
async function isLoaded(image: Locator): Promise<boolean> {
	return image.evaluate(
		(element) => element instanceof HTMLImageElement && element.naturalWidth > 0,
	);
}

// oxlint-disable-next-line max-statements -- one flow through the page, step by step
test('an admin sets up the brand', async () => {
	await admin.goto('/');
	await admin.getByRole('link', { name: 'CD einrichten' }).click();
	await expect(admin).toHaveURL(/\/admin\/brand$/u);
	await expect(admin).toHaveTitle('CD – Vereinsbote');
	await expect(admin.getByRole('heading', { exact: true, level: 1, name: 'CD' })).toBeVisible();
	const save = admin.getByRole('button', { name: 'Speichern' });
	await expect(save).toBeEnabled();
	await expect(admin.getByText('Impressum und Datenschutz werden empfohlen.')).toBeVisible();

	// A second tab opened before the first saves: its save is refused later.
	const other = await admin.context().newPage();
	await other.goto('/admin/brand');
	await expect(other.getByRole('button', { name: 'Speichern' })).toBeEnabled();

	await admin.getByLabel('Vereinsname').fill('Sportverein Beispiel');
	const frame = admin.frameLocator(`iframe[title="${FRAME_TITLE}"]`);
	await expect(frame.locator('body')).toContainText('Sportverein Beispiel');
	// The page and the mail of the preview, as long as the colours are the neutral ones.
	await expectNoA11yViolations(admin);

	// The real upload: the SVG becomes a PNG in the browser and shows in the preview.
	const header = admin.getByRole('group', { name: 'Kopf-Logo' });
	const chooser = admin.waitForEvent('filechooser');
	await header.getByRole('button', { name: 'Bild auswählen' }).click();
	const fileChooser = await chooser;
	await fileChooser.setFiles({
		buffer: Buffer.from(LOGO_SVG),
		mimeType: 'image/svg+xml',
		name: 'logo.svg',
	});
	await expect(header.getByText('Das Bild wurde hochgeladen.')).toBeVisible();
	const logo = frame.locator('img[src*="/media/"]').first();
	await expect(logo).toHaveAttribute('src', /\/media\/[\w-]{22}\.png$/u);
	await expect.poll(async () => isLoaded(logo)).toBe(true);
	const logoPath = new URL((await logo.getAttribute('src')) ?? '').pathname;

	// A weak text colour is flagged at its field; saving stays possible.
	const textColor = admin.getByLabel('Textfarbe');
	await textColor.fill('#777777');
	await textColor.blur();
	await expect(admin.getByText(/Kontrast 4,4\d:1, empfohlen mindestens 4,5:1/u)).toBeVisible();

	// A link to Instagram can be shown as an icon, others only as text.
	await admin.getByRole('button', { name: 'Link hinzufügen' }).click();
	await expect(admin.getByRole('radio', { name: 'Icon' })).toBeDisabled();
	await admin.getByLabel('Adresse von Link 1').fill('https://www.instagram.com/verein.example');
	// The radio's input is visually hidden: the visible label is what a pointer presses.
	await admin.getByText('Icon', { exact: true }).click();
	await expect(admin.getByRole('radio', { name: 'Icon' })).toBeChecked();
	const icon = frame.locator('img[src*="/social/instagram-"]');
	await expect(icon).toBeVisible();
	await expect.poll(async () => isLoaded(icon)).toBe(true);

	// The preview at phone width and as text.
	const modes = admin.getByRole('radiogroup', { name: 'Darstellung der Vorschau' });
	await modes.getByRole('radio', { name: 'Mobil' }).check();
	await expect(admin.locator(`iframe[title="${FRAME_TITLE}"]`)).toHaveCSS('width', '375px');
	await modes.getByRole('radio', { name: 'Nur Text' }).check();
	await expect(admin.locator('pre')).toContainText('Einladung zum Sommerfest');
	await modes.getByRole('radio', { name: 'Desktop' }).check();
	await expect(frame.locator('img[src*="/media/"]').first()).toBeVisible();

	// The frame shows the mail in the colours just chosen, weak ones included: not part of the check.
	await expectNoA11yViolations(admin, [`iframe[title="${FRAME_TITLE}"]`]);

	await save.click();
	await expect(admin.getByText('Das CD wurde gespeichert.')).toBeVisible();

	// The notice on the start page is gone.
	await admin.goto('/');
	await expect(admin.getByRole('heading', { name: 'Deine Bereiche' })).toBeVisible();
	await expect(admin.getByRole('link', { name: 'CD einrichten' })).toHaveCount(0);

	// The logo is served as a PNG, and the page shows what was saved.
	const media = await admin.request.get(logoPath);
	expect(media.status()).toBe(HTTP_OK);
	expect(media.headers()['content-type']).toBe('image/png');
	await admin.goto('/admin/brand');
	await expect(admin.getByLabel('Vereinsname')).toHaveValue('Sportverein Beispiel');
	await expect(admin.getByLabel('Textfarbe')).toHaveValue('#777777');

	// The other tab still has the old version: its save is refused, and reloading shows the saved CD.
	await other.getByLabel('Vereinsname').fill('Anderer Name');
	await other.getByRole('button', { name: 'Speichern' }).click();
	await expect(other.getByRole('alert')).toContainText(
		'Das CD wurde inzwischen geändert. Neu laden?',
	);
	await other.getByRole('button', { name: 'Neu laden' }).click();
	await expect(other.getByLabel('Vereinsname')).toHaveValue('Sportverein Beispiel');
	await other.close();
});

// oxlint-disable-next-line max-statements -- one navigation, checked at each stop
test('the admin navigation marks only the current page', async () => {
	await admin.goto('/admin/brand');
	const adminNav = admin.getByRole('navigation', { name: 'Verwaltung' });
	await expect(adminNav.getByRole('link', { name: 'CD' })).toHaveAttribute('aria-current', 'page');
	await expect(adminNav.locator('[aria-current="page"]')).toHaveCount(1);
	const mainNav = admin.getByRole('navigation', { name: 'Hauptnavigation' });
	await expect(mainNav.getByRole('link', { name: 'Verwaltung' })).not.toHaveAttribute(
		'aria-current',
	);
	await admin.getByRole('link', { name: 'Benutzer' }).click();
	await expect(admin).toHaveURL(/\/admin\/users$/u);
	await expect(adminNav.getByRole('link', { name: 'Benutzer' })).toHaveAttribute(
		'aria-current',
		'page',
	);
	await expect(adminNav.getByRole('link', { name: 'CD' })).not.toHaveAttribute('aria-current');
	await expect(mainNav.getByRole('link', { name: 'Verwaltung' })).not.toHaveAttribute(
		'aria-current',
	);
});

// oxlint-disable-next-line max-statements -- one flow on a phone, step by step
test('on a phone the preview is on a tab of its own', async () => {
	await admin.setViewportSize({ height: 800, width: 390 });
	try {
		await admin.goto('/admin/brand');
		const settings = admin.getByRole('tab', { name: 'Einstellungen' });
		const preview = admin.getByRole('tab', { name: 'Vorschau' });
		await expect(admin.getByRole('tablist', { name: 'Einstellungen und Vorschau' })).toBeVisible();
		await expect(settings).toHaveAttribute('aria-selected', 'true');
		await expect(admin.getByLabel('Vereinsname')).toBeVisible();
		await expectNoA11yViolations(admin);
		// Keyboard: arrow keys switch the tab.
		await settings.focus();
		await admin.keyboard.press('ArrowRight');
		await expect(preview).toHaveAttribute('aria-selected', 'true');
		await expect(admin.locator('iframe')).toHaveCount(1);
		const frame = admin.frameLocator('iframe[title="Vorschau einer Mail mit dem CD"]');
		await expect(frame.locator('body')).toContainText('Einladung zum Sommerfest');
		await expect(admin.getByLabel('Vereinsname')).toBeHidden();
		await expectNoA11yViolations(admin, ['iframe']);
	} finally {
		await admin.setViewportSize({ height: 720, width: 1280 });
	}
});
