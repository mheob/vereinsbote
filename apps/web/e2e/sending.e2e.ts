import type { Locator, Page } from '@playwright/test';

import { E2E_SERVER_ENV, E2E_URL } from './env';
import { expectNoA11yViolations } from './helpers/a11y';
import { newAdminContext } from './helpers/admin-session';
import { deleteAllMessages, latestLink, listMessages } from './helpers/mailpit';
import { recordedRequests, resetProviders, setSenders } from './helpers/providers';
import { LOGIN_LINK } from './helpers/sign-in';
import { expect, test } from './helpers/test';
import { runTick } from './helpers/tick';

/*
 * The sending foundations, as the admin sees them: a connection to the fake Microsoft Graph
 * (`e2e/fakes/providers.ts`, which hands accepted mail to Mailpit), a sender, the system sender,
 * and what the app tells about a disturbed connection or a secret about to expire. Runs after the
 * project `templates`; the club, its areas and the admin's session come from `fundament`. The tests
 * build on each other and share the page of the admin. Once the system sender is set, the login
 * links and invitations of the later tests go through the fake Graph, not through DEV_SMTP_URL.
 */
test.describe.configure({ mode: 'serial' });

// oxlint-disable-next-line init-declarations -- signed in once in `beforeAll`, shared by the serial tests
let admin: Page;

test.beforeAll(async ({ browser }, testInfo) => {
	const context = await newAdminContext(browser, testInfo);
	admin = await context.newPage();
});

test.afterAll(async () => {
	await admin.context().close();
});

/** Where the tick endpoint of the app is. */
const APP = { cronSecret: E2E_SERVER_ENV.CRON_SECRET, url: E2E_URL };
const CONNECTION_NAME = 'Vereins-Graph';
const SENDER_ADDRESS = 'verein@verein.test';
const ONE_MINUTE_MS = 60_000;
const DAYS_AHEAD = 10;
const DAY_MS = 86_400_000;
const ANSWER_WAIT_MS = 3000;
const INVITE_TIMEOUT_MS = 120_000;
const RESEND_POLL_MS = 5000;
const FLOW_TIMEOUT_MS = 90_000;

/** @returns The subjects of the mails in Mailpit, oldest first. */
async function subjects(): Promise<string[]> {
	const messages = await listMessages();
	return messages.map(({ subject }) => subject);
}

/** @returns The mails the fake Graph took since the last reset. */
async function graphMails(): Promise<Awaited<ReturnType<typeof recordedRequests>>> {
	const requests = await recordedRequests();
	return requests.filter(({ path }) => path.endsWith('/sendMail'));
}

/**
 * Types a date into a React Aria date field of the German page: day, month, year.
 *
 * @param field The group of the date field.
 * @param date The date as `DDMMYYYY`.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a locator is a handle on the page
async function typeDate(field: Locator, date: string): Promise<void> {
	await field.getByRole('spinbutton').first().click();
	await field.page().keyboard.type(date);
}

/**
 * The date in the club's zone some days from now, as a date field takes it.
 *
 * @param days How many days ahead.
 * @returns `DDMMYYYY`.
 */
function dateAhead(days: number): string {
	const parts = new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
		timeZone: 'Europe/Berlin',
		year: 'numeric',
	}).formatToParts(new Date(Date.now() + days * DAY_MS));
	const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
	return `${part('day')}${part('month')}${part('year')}`;
}

/**
 * Saves the secret of the connection on its page; the check of the credentials runs after the
 * save and its line shows below the form.
 *
 * @param page The admin's page, on the connection's page.
 * @param secret The new client secret.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
async function saveSecret(page: Page, secret: string): Promise<void> {
	await page.getByLabel('Client-Secret', { exact: true }).fill(secret);
	await page.getByRole('button', { name: 'Speichern' }).click();
}

/**
 * Opens the page of the connection from the overview.
 *
 * @param page The admin's page.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see saveSecret
async function openConnection(page: Page): Promise<void> {
	await page.goto('/admin/sending');
	await page.getByRole('link', { name: CONNECTION_NAME }).first().click();
	await expect(page.getByRole('heading', { level: 1, name: CONNECTION_NAME })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();
}

// oxlint-disable-next-line max-statements -- one flow through the pages, step by step
test('an admin connects graph, adds a sender and makes it the system sender', async () => {
	test.setTimeout(FLOW_TIMEOUT_MS);
	await deleteAllMessages();
	await resetProviders();
	// No mailbox of the tenant is readable: the restriction of the app registration works.
	await setSenders([]);

	await admin.goto('/');
	await expect(admin.getByText('Noch kein Absender für Systemmails')).toBeVisible();
	await admin.getByRole('link', { name: 'Absender für Systemmails festlegen' }).click();
	await expect(admin).toHaveURL(/\/admin\/sending$/u);
	await expect(admin).toHaveTitle('Versand – Vereinsbote');
	await expect(
		admin.getByRole('heading', { exact: true, level: 1, name: 'Versand' }),
	).toBeVisible();
	await expect(admin.getByText('Es gibt noch keine Anbindung.')).toBeVisible();
	await expect(
		admin.getByText('Es ist noch kein Absender für Systemmails festgelegt.'),
	).toBeVisible();
	await expectNoA11yViolations(admin);

	await admin.getByRole('link', { name: 'Anbindung anlegen' }).click();
	await expect(admin.getByRole('heading', { level: 1, name: 'Anbindung anlegen' })).toBeVisible();
	await admin.getByLabel('Name', { exact: true }).fill(CONNECTION_NAME);
	await admin.getByLabel('Tenant-ID').fill('00000000-0000-4000-8000-000000000001');
	await admin.getByLabel('Client-ID').fill('00000000-0000-4000-8000-000000000002');
	await admin.getByLabel('Client-Secret', { exact: true }).fill('a-valid-test-secret');
	await typeDate(admin.getByRole('group', { name: 'Secret läuft ab am' }), '31122030');
	await expectNoA11yViolations(admin);
	await admin.getByRole('button', { name: 'Anlegen' }).click();

	// The check of the credentials ran with the save.
	await expect(admin.getByRole('heading', { level: 1, name: CONNECTION_NAME })).toBeVisible();
	await expect(admin.getByText('Zugangsdaten in Ordnung')).toBeVisible();
	await expect(admin.getByRole('status')).toHaveText(
		`Die Anbindung „${CONNECTION_NAME}“ wurde angelegt.`,
	);
	await expect(admin.getByLabel('Client-Secret', { exact: true })).toHaveValue('');
	await expectNoA11yViolations(admin);
	// The notice shows once: a reload of the page does not announce the creation again.
	await admin.reload();
	await expect(admin.getByRole('heading', { level: 1, name: CONNECTION_NAME })).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Speichern' })).toBeEnabled();
	await expect(admin.getByRole('status')).toHaveText('');
	await expect(admin.getByText('wurde angelegt')).toHaveCount(0);

	await admin.getByRole('link', { name: 'Zurück zum Versand' }).click();
	await admin.getByRole('link', { name: 'Absender anlegen' }).click();
	await expect(admin.getByRole('heading', { level: 1, name: 'Absender anlegen' })).toBeVisible();
	await admin.getByLabel('Absenderadresse').fill(SENDER_ADDRESS);
	await admin.getByLabel('Anzeigename').fill('Sportverein Beispiel');
	// The visible box covers the hidden input of the checkbox; a click on its label ticks it.
	await admin.getByText('Finanzen', { exact: true }).click();
	await expect(admin.getByRole('checkbox', { name: 'Finanzen' })).toBeChecked();
	await expectNoA11yViolations(admin);
	await admin.getByRole('button', { name: 'Anlegen' }).click();

	// A new sender is tested at once: the test mail went to the admin, and the tenant restriction works.
	await expect(admin.getByRole('heading', { level: 1, name: SENDER_ADDRESS })).toBeVisible();
	const result = admin.getByRole('region', { name: 'Ergebnis des Selbsttests' });
	await expect(result).toContainText('Testmail verschickt');
	await expect(result).toContainText('Beschränkung wirkt');
	await expect.poll(subjects).toContain('Testmail von Vereinsbote');
	await expectNoA11yViolations(admin);

	await admin.getByRole('button', { name: 'Als Systemabsender festlegen' }).click();
	await expect(admin.getByText('Der Absender verschickt jetzt die Systemmails.')).toBeVisible();
	await expect(
		admin.getByText('Dieser Absender verschickt die Systemmails (Anmeldelinks, Einladungen).'),
	).toBeVisible();
	await expectNoA11yViolations(admin);

	await admin.getByRole('link', { name: 'Zurück zum Versand' }).click();
	await expect(admin.getByRole('row', { name: new RegExp(SENDER_ADDRESS, 'u') })).toContainText(
		'Finanzen',
	);
	await expect(
		admin.getByText('Es ist noch kein Absender für Systemmails festgelegt.'),
	).toHaveCount(0);
	await expectNoA11yViolations(admin);
	await admin.goto('/');
	await expect(admin.getByRole('heading', { name: 'Deine Bereiche' })).toBeVisible();
	await expect(admin.getByText('Noch kein Absender für Systemmails')).toHaveCount(0);
});

// oxlint-disable-next-line max-statements -- one flow through the pages, step by step
test('a login link comes through graph and signs in only after confirming', async ({ browser }) => {
	// A user of their own: the server sends one login link per address and minute.
	await admin.goto('/admin/users');
	await admin.getByLabel('Name', { exact: true }).fill('Mia');
	await admin.getByLabel('E-Mail').fill('mia@verein.test');
	await admin.getByRole('button', { name: 'Einladen' }).click();
	await expect(admin.getByRole('row', { name: /Mia/u })).toBeVisible();
	// Only the requests since then count: the invitation went through the system sender as well.
	await resetProviders();
	await setSenders([]);

	// An address of its own for the rate limiter: the sign-ins of the earlier projects may have used
	// up the five requests per minute that Better Auth allows from one address.
	const context = await browser.newContext({
		extraHTTPHeaders: { 'x-forwarded-for': '127.0.0.9' },
	});
	const mia = await context.newPage();
	await mia.goto('/login');
	const request = mia.getByRole('button', { name: 'Anmeldelink anfordern' });
	await expect(request).toBeEnabled();
	await mia.getByLabel('E-Mail').fill('mia@verein.test');
	await request.click();
	await expect(mia.getByRole('status')).toContainText('mia@verein.test');

	// The mail went through the fake Graph; without the system sender it would have used DEV_SMTP_URL.
	const link = await latestLink('mia@verein.test', LOGIN_LINK);
	expect(await graphMails(), 'the login link went through Graph').not.toHaveLength(0);

	// Opening the link (as a mail scanner would) shows the confirmation page and signs nobody in.
	await mia.goto(link);
	await expect(mia).toHaveTitle('Anmeldung bestätigen – Vereinsbote');
	const confirm = mia.getByRole('button', { exact: true, name: 'Anmelden' });
	await expect(confirm).toBeEnabled();
	await mia.goto('/');
	await expect(mia).toHaveURL(/\/login$/u);

	// The link was not used up by that: the button signs in.
	await mia.goto(link);
	await expect(confirm).toBeEnabled();
	await confirm.click();
	await expect(mia.getByRole('heading', { name: 'Deine Bereiche' })).toBeVisible();
	await context.close();
});

test('the system mail is not saved in sent items', async () => {
	const mails = await graphMails();
	expect(mails).not.toHaveLength(0);
	// JSON mails only; `savedToSentItems` is what the app asked of Graph.
	expect(mails.map(({ savedToSentItems }) => savedToSentItems)).toStrictEqual(
		mails.map(() => false),
	);
});

// oxlint-disable-next-line max-statements -- one flow through the pages, step by step
test('a disturbed connection shows up and recovers with a new secret', async () => {
	await openConnection(admin);
	await saveSecret(admin, 'wrong-secret');
	await expect(admin.getByText('Zugangsdaten abgelehnt')).toBeVisible();
	await runTick(APP);

	await admin.goto('/admin/sending');
	await expect(admin.getByRole('row', { name: new RegExp(CONNECTION_NAME, 'u') })).toContainText(
		'Gestört seit',
	);
	await expectNoA11yViolations(admin);
	await admin.goto('/');
	await expect(
		admin.getByText('Mindestens eine Anbindung ist gestört: Darüber wird nichts versendet.'),
	).toBeVisible();
	await expectNoA11yViolations(admin);

	// The refused connection is the system sender, so an invitation cannot go out: the user is
	// invited anyway and the list says the mail failed.
	await admin.goto('/admin/users');
	await admin.getByLabel('Name', { exact: true }).fill('Lena');
	await admin.getByLabel('E-Mail').fill('lena@verein.test');
	await admin.getByRole('button', { name: 'Einladen' }).click();
	const lena = admin.getByRole('row', { name: /Lena/u });
	await expect(lena.getByText('Einladung nicht verschickt')).toBeVisible();

	await openConnection(admin);
	await saveSecret(admin, 'a-new-valid-secret');
	await expect(admin.getByText('Zugangsdaten in Ordnung')).toBeVisible();
	await admin.goto('/admin/sending');
	await expect(admin.getByRole('row', { name: new RegExp(CONNECTION_NAME, 'u') })).toContainText(
		'In Ordnung',
	);
	await admin.goto('/');
	await expect(admin.getByRole('heading', { name: 'Deine Bereiche' })).toBeVisible();
	await expect(admin.getByText('Mindestens eine Anbindung ist gestört')).toHaveCount(0);
});

test('an admin resends a failed invitation', async () => {
	test.setTimeout(INVITE_TIMEOUT_MS + ONE_MINUTE_MS);
	await admin.goto('/admin/users');
	const lena = admin.getByRole('row', { name: /Lena/u });
	await expect(lena.getByText('Einladung nicht verschickt')).toBeVisible();
	// A resend waits a minute after the last invitation mail, failed ones included.
	await expect(async () => {
		await lena.getByRole('button', { name: 'Einladung erneut senden' }).click();
		// The list's state decides, not a notice that may fade: the mark goes once the mail went out;
		// a refusal (too soon) leaves it, and the next round clicks again.
		await expect(lena.getByText('Einladung nicht verschickt')).toHaveCount(0, {
			timeout: ANSWER_WAIT_MS,
		});
	}).toPass({ intervals: [RESEND_POLL_MS], timeout: INVITE_TIMEOUT_MS });
	await expect(lena.getByText('Einladung nicht verschickt')).toHaveCount(0);
	expect(await latestLink('lena@verein.test', /\/login/u)).toMatch(/\/login$/u);
	await expectNoA11yViolations(admin);
});

// oxlint-disable-next-line max-statements -- one flow through the pages, step by step
test('a secret about to expire is shown to admins', async () => {
	await openConnection(admin);
	await typeDate(admin.getByRole('group', { name: 'Secret läuft ab am' }), dateAhead(DAYS_AHEAD));
	await admin.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByRole('status')).toHaveText('Gespeichert.');

	await admin.goto('/admin/sending');
	await expect(admin.getByRole('row', { name: new RegExp(CONNECTION_NAME, 'u') })).toContainText(
		/Secret läuft in \d+ Tagen ab/u,
	);
	await admin.goto('/');
	await expect(
		admin.getByText('Das Secret mindestens einer Anbindung läuft in weniger als 30 Tagen ab.'),
	).toBeVisible();
	await expectNoA11yViolations(admin);

	// The tick warns the admins by mail, through the connection that is about to expire.
	await runTick(APP);
	await expect
		.poll(subjects)
		.toContain(`Das Secret der Anbindung ${CONNECTION_NAME} läuft bald ab`);
});
