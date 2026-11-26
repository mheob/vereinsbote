import type { Browser, Locator, Page } from '@playwright/test';

import { E2E_SERVER_ENV, E2E_URL } from './env';
import { expectNoA11yViolations } from './helpers/a11y';
import { newAdminContext } from './helpers/admin-session';
import {
	deleteAllMessages,
	latestLink,
	listMessages,
	messageDetails,
	messagesTo,
} from './helpers/mailpit';
import type { ListedMessage } from './helpers/mailpit';
import {
	addNdr,
	recordedRequests,
	resendMails,
	resetProviders,
	sendResendWebhook,
	setSenders,
} from './helpers/providers';
import { LOGIN_LINK, signIn } from './helpers/sign-in';
import { expect, test } from './helpers/test';
import { runTick } from './helpers/tick';

/*
 * The sending foundations, as the admin sees them: a connection to the fake Microsoft Graph
 * (`e2e/fakes/providers.ts`, which hands accepted mail to Mailpit), a sender, the system sender,
 * and what the app tells about a disturbed connection or a secret about to expire. Then occasions
 * and manual sending, as Eva sees them, who edits „Veranstaltungen“ since the project `templates`
 * and may send there from the first occasion test on: a circular with an attachment, the
 * unsubscribe page and the one-click unsubscribe, the daily limit, a bounce and a stopped wave. Runs
 * after the project `templates`; the club, its areas and the admin's session come from
 * `fundament`. The tests build on each other and share the pages of the admin and of Eva. Once the
 * system sender is set, the login links and invitations of the later tests go through the fake
 * Graph, not through DEV_SMTP_URL.
 */
test.describe.configure({ mode: 'serial' });

// oxlint-disable-next-line init-declarations -- signed in once in `beforeAll`, shared by the serial tests
let admin: Page;
/** Eva, who sends in „Veranstaltungen“; signed in by the first occasion test, then kept. */
// oxlint-disable-next-line init-declarations -- set by a serial test, closed in `afterAll`
let evaPage: Page | undefined;

test.beforeAll(async ({ browser }, testInfo) => {
	const context = await newAdminContext(browser, testInfo);
	admin = await context.newPage();
});

test.afterAll(async () => {
	await admin.context().close();
	await evaPage?.context().close();
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
 * Types a date into a React Aria date field of the German page: day, month, year and, in a field
 * with a time, hour and minute. Each segment moves on to the next once it is full.
 *
 * @param field The group of the date field.
 * @param date The digits of the segments, e.g. `DDMMYYYY` or `DDMMYYYYHHmm`.
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

/*
 * Occasions and manual sending (sub-plan 4b). The admin edits „Finanzen“ and „Mitglieder“ but has no
 * access to „Veranstaltungen“, so the admin role alone shows no recipient of its waves. The circular
 * goes through the Graph sender above: the fake keeps the attachments of Graph mails (not those of
 * Resend), so Mailpit shows them.
 */

const EVENTS = 'Veranstaltungen';
const CIRCULAR = 'Sommerfest-Einladung';
/** A block template of „Veranstaltungen“ (project `templates`) that greets by first name. */
const INVITATION_TEMPLATE = 'Sommerfest';
/** An imported HTML template of „Veranstaltungen“ without placeholders. */
const NEWSLETTER_TEMPLATE = 'Rundbrief';
const SENDER_LABEL = `Sportverein Beispiel <${SENDER_ADDRESS}>`;
const LIMIT_ADDRESS = 'kurz@verein.test';
const LIMIT_NAME = 'Sportverein Kurzmeldungen';
const ADMIN_ADDRESS = 'admin@verein.test';
const EVA_ADDRESS = 'eva@verein.test';
const COMMITTEE_TAG = 'Festausschuss';
const FAMILY_ADDRESS = 'familie.vogel@example.org';
const SINGLE_ADDRESS = 'ines.brenner@example.org';
const PREVIEW_FRAME = 'iframe[title="Vorschau der Mail"]';
const PDF_NAME = 'programm.pdf';
const MERGED_LABEL = 'Adressen, die mehrere Kontakte teilen (eine Mail für alle)';
const NOT_FOUND = 'Seite nicht gefunden';
const OCCASION_PAGE = /\/occasions\/(?<id>[\w-]{36})$/u;
const CONNECTION_PAGE = /\/admin\/sending\/connections\/(?<id>[\w-]{36})$/u;
const RESEND_CONNECTION = 'Vereins-Resend';
const RESEND_ADDRESS = 'zeitung@verein.test';
const RESEND_NAME = 'Vereinszeitung';
/** The signing secret of the Resend webhook: `whsec_` and invented bytes in base64. */
const WEBHOOK_SECRET = `whsec_${Buffer.from('e2e-only-webhook-signing-secret').toString('base64')}`;
/** The member whose newsletter through Resend bounces. */
const RESEND_BOUNCE: readonly [string, string] = ['Alex Albers', 'alex.albers@example.org'];
const HOUR_MS = 3_600_000;
const MAIL_TIMEOUT_MS = 15_000;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

/** A partner of the festival committee; the Vogels share the address of their family. */
type CommitteePartner = Readonly<{
	firstName: string;
	lastName: string;
	email: string;
	customerNumber: string;
}>;

const COMMITTEE: readonly CommitteePartner[] = [
	{ customerNumber: '200001', email: FAMILY_ADDRESS, firstName: 'Hanna', lastName: 'Vogel' },
	{ customerNumber: '200002', email: FAMILY_ADDRESS, firstName: 'Tom', lastName: 'Vogel' },
	{ customerNumber: '200003', email: SINGLE_ADDRESS, firstName: 'Ines', lastName: 'Brenner' },
];

/** Members of the project `contacts` and their addresses, for the daily limit. */
const PERSONAL_PICKS: readonly (readonly [string, string])[] = [
	['Clara Conrad', 'clara.conrad@example.org'],
	['Moritz Maier', 'moritz.maier@example.org'],
];
const CIRCULAR_PICKS: readonly (readonly [string, string])[] = [
	['Ida Iske', 'ida.iske@example.org'],
	['Kim Kraus', 'kim.kraus@example.org'],
	['Oskar Ott', 'oskar.ott@example.org'],
	['Simon Sommer', 'simon.sommer@example.org'],
	['Wim Wolff', 'wim.wolff@example.org'],
];
/** The members of the group „Tischtennis“ with an address. */
const TABLE_TENNIS_ADDRESSES: readonly string[] = [
	'david.dietz@example.org',
	'hannes.hahn@example.org',
	'lena.lorenz@example.org',
	'paula.peters@example.org',
	'tilda.thiel@example.org',
	'xenia.xander@example.org',
];

/** A small PDF, written here (no binary fixture); the server checks its signature `%PDF-`. */
const PDF_BYTES = Buffer.from(
	[
		'%PDF-1.4',
		'1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
		'2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
		'3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]>> endobj',
		'trailer <</Root 1 0 R>>',
		'%%EOF',
		'',
	].join('\n'),
	'latin1',
);

/** What the serial occasion tests hand on. */
const shared = { circularId: '', waveUrl: '' };

/** @returns Eva's page, signed in by the first occasion test. */
function signedInEva(): Page {
	if (evaPage === undefined) throw new Error('Eva is not signed in.');
	return evaPage;
}

/**
 * Chooses an option of a React Aria select by its label (the select's button is named by its label
 * and its value).
 *
 * @param page The page.
 * @param choice The label of the select and the option.
 */
async function choose(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is a handle on the browser, mutable by design
	page: Page,
	choice: Readonly<{ label: string; option: string }>,
): Promise<void> {
	const { label, option } = choice;
	await page.getByRole('button', { name: new RegExp(`\\b${label}\\b`, 'u') }).click();
	await page.getByRole('option', { exact: true, name: option }).click();
}

/**
 * Ticks the checkbox of an area among the areas a sender is released to.
 *
 * @param page The admin's page with the sender form.
 * @param area The area.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function releaseTo(page: Page, area: string): Promise<void> {
	// The visible box covers the hidden input of the checkbox; a click on its label ticks it.
	await page
		.getByRole('group', { name: 'Freigegebene Bereiche' })
		.getByText(area, { exact: true })
		.click();
	await expect(page.getByRole('checkbox', { name: area })).toBeChecked();
}

/**
 * Opens a sender's page from the sending page of the admins.
 *
 * @param page The admin's page.
 * @param address The sender's address.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function openSender(page: Page, address: string): Promise<void> {
	await page.goto('/admin/sending');
	await page.getByRole('link', { exact: true, name: address }).click();
	await expect(page.getByRole('heading', { level: 1, name: address })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();
}

/**
 * Creates a partner of the festival committee, as the admin does (the admin edits „Finanzen“, the
 * partners area).
 *
 * @param page The admin's page.
 * @param partner The partner.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function createPartner(page: Page, partner: CommitteePartner): Promise<void> {
	await page.goto('/contacts?kind=partner');
	await page.getByRole('link', { name: 'Partner anlegen' }).click();
	const save = page.getByRole('button', { name: 'Speichern' });
	await expect(save).toBeEnabled();
	for (const [label, value] of [
		['Vorname', partner.firstName],
		['Nachname', partner.lastName],
		['E-Mail', partner.email],
		['Kundennummer', partner.customerNumber],
	] as const) {
		// oxlint-disable-next-line no-await-in-loop -- one field after another, as a user types
		await page.getByLabel(label, { exact: true }).fill(value);
	}
	await page.getByLabel('Schlagwort hinzufügen').fill(COMMITTEE_TAG);
	await page.keyboard.press('Enter');
	await save.click();
	await expect(
		page.getByRole('heading', { level: 1, name: `${partner.firstName} ${partner.lastName}` }),
	).toBeVisible();
}

/** An occasion as the editor enters it: the kind as the form names it. */
type NewOccasion = Readonly<{
	name: string;
	kind: 'Persönlich' | 'Rundschreiben';
	template: string;
	sender: string;
}>;

/**
 * Fills the form of a new occasion in „Veranstaltungen“.
 *
 * @param page Eva's page, on the form.
 * @param occasion The occasion.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function fillOccasion(page: Page, occasion: NewOccasion): Promise<void> {
	await choose(page, { label: 'Bereich', option: EVENTS });
	await page.getByLabel('Name', { exact: true }).fill(occasion.name);
	await page
		.getByRole('radiogroup', { name: 'Art' })
		.getByText(occasion.kind, { exact: true })
		.click();
	await choose(page, { label: 'Vorlage', option: occasion.template });
	await choose(page, { label: 'Absender', option: occasion.sender });
}

/**
 * Creates an occasion in „Veranstaltungen“ and waits for its page.
 *
 * @param page Eva's page.
 * @param occasion The occasion.
 * @returns The occasion's id.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function createOccasion(page: Page, occasion: NewOccasion): Promise<string> {
	await page.goto('/occasions/new');
	const create = page.getByRole('button', { name: 'Anlass anlegen' });
	await expect(create).toBeEnabled();
	await fillOccasion(page, occasion);
	await create.click();
	await expect(page).toHaveURL(OCCASION_PAGE);
	await expect(page.getByRole('heading', { level: 1, name: occasion.name })).toBeVisible();
	return OCCASION_PAGE.exec(page.url())?.groups?.id ?? '';
}

/**
 * Opens the send flow of an occasion on its first step.
 *
 * @param page Eva's page.
 * @param occasionId The occasion.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function openSendFlow(page: Page, occasionId: string): Promise<void> {
	await page.goto(`/occasions/${occasionId}/send`);
	await expect(
		page.getByRole('heading', { level: 2, name: 'Schritt 1 von 3: Empfänger' }),
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Weiter' })).toBeEnabled();
}

/**
 * Goes on to the next step of the send flow, whose heading takes the focus.
 *
 * @param page Eva's page.
 * @param heading The heading of that step.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function nextStep(page: Page, heading: string): Promise<void> {
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByRole('heading', { level: 2, name: heading })).toBeFocused();
}

/**
 * A number of the wave, as the server counted it: the value next to its label.
 *
 * @param scope The part of the page with the numbers (the recipient step or the dialog).
 * @param label The label of the number.
 * @returns The value.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a Playwright locator
function countOf(scope: Locator, label: string): Locator {
	return scope.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]');
}

/**
 * Selects the partners of the festival committee by kind and tag.
 *
 * @param page Eva's page, on the first step of the send flow.
 * @returns The numbers of the wave.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function chooseCommittee(page: Page): Promise<Locator> {
	await page
		.getByRole('radiogroup', { name: 'Wer bekommt die Mail?' })
		.getByText('Partner', { exact: true })
		.click();
	await choose(page, { label: 'Schlagwort', option: COMMITTEE_TAG });
	return page.getByRole('region', { name: 'Diese Welle' });
}

/**
 * Picks members one by one, each by a search for its address.
 *
 * @param page Eva's page, on the first step of the send flow.
 * @param picks The members' names and addresses.
 */
async function pickMembers(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
	page: Page,
	picks: readonly (readonly [string, string])[],
): Promise<void> {
	await page.getByRole('radiogroup', { name: 'Auswahl' }).getByText('Einzeln auswählen').click();
	for (const [name, address] of picks) {
		// oxlint-disable-next-line no-await-in-loop -- one pick after another, as a user does
		await page.getByRole('combobox', { name: 'Kontakt hinzufügen' }).fill(address);
		// oxlint-disable-next-line no-await-in-loop -- see above
		await page.getByRole('option', { name: `${name} (Mitglied)` }).click();
		// oxlint-disable-next-line no-await-in-loop -- see above
		await expect(page.getByText(`${name} ist ausgewählt.`)).toBeVisible();
	}
	// The suggestions stay open for the next pick and hide the rest of the page until they close.
	await page.keyboard.press('Escape');
	const chosen = page.getByRole('region', { name: 'Ausgewählt' }).getByRole('listitem');
	await expect(chosen).toHaveText(picks.map(([name]) => `${name} (Mitglied)`));
}

/**
 * Opens the confirmation of the send flow from its last step.
 *
 * @param page Eva's page, on the preview step.
 * @param occasion The occasion's name.
 * @returns The dialog.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function openConfirmation(page: Page, occasion: string): Promise<Locator> {
	await page.getByRole('button', { name: 'Versand bestätigen …' }).click();
	const dialog = page.getByRole('dialog', { name: `„${occasion}“ versenden?` });
	await expect(dialog).toBeVisible();
	return dialog;
}

/**
 * Sends a selection made on the first step at once, past the attachments and the preview.
 *
 * @param page Eva's page, on the first step of the send flow.
 * @param occasion The occasion's name.
 * @param mails How many mails the wave makes.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function sendNow(page: Page, occasion: string, mails: number): Promise<void> {
	await nextStep(page, 'Schritt 2 von 3: Anhänge');
	await nextStep(page, 'Schritt 3 von 3: Vorschau und Testmail');
	const dialog = await openConfirmation(page, occasion);
	await expect(countOf(dialog, 'Mails')).toHaveText(String(mails));
	await dialog.getByRole('button', { name: 'Jetzt versenden' }).click();
	await expect(page.getByRole('heading', { level: 1, name: occasion })).toBeFocused();
	await expect(
		page.getByText(`Die Welle ist angelegt (Mails: ${mails}); die ersten gehen gleich raus.`),
	).toBeVisible();
}

/**
 * Opens the sending overview of „Veranstaltungen“; Eva also reads „Finanzen“, which comes first.
 *
 * @param page Eva's page.
 * @returns The table of the waves.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function openEventsOverview(page: Page): Promise<Locator> {
	await page.goto('/sending');
	await expect(page.getByRole('heading', { level: 1, name: 'Versand' })).toBeVisible();
	await choose(page, { label: 'Bereich', option: EVENTS });
	await expect(page.getByText(`Der Versand in ${EVENTS} wird angezeigt.`)).toBeVisible();
	return page.getByRole('grid', { name: `Wellen in ${EVENTS}` });
}

/**
 * The date and time in the club's zone some time from now, as a date field with a time takes it.
 *
 * @param ms How far ahead.
 * @returns `DDMMYYYYHHmm`.
 */
function clubClockAhead(ms: number): string {
	const parts = new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		hour: '2-digit',
		hourCycle: 'h23',
		minute: '2-digit',
		month: '2-digit',
		timeZone: 'Europe/Berlin',
		year: 'numeric',
	}).formatToParts(new Date(Date.now() + ms));
	const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
	return `${part('day')}${part('month')}${part('year')}${part('hour')}${part('minute')}`;
}

/**
 * How many mails went to an address.
 *
 * @param address The recipient.
 * @returns The number.
 */
async function countMailsTo(address: string): Promise<number> {
	const mails = await messagesTo(address);
	return mails.length;
}

/**
 * The first link of the `List-Unsubscribe` header of the only mail to an address.
 *
 * @param address The recipient.
 * @returns The link.
 */
async function unsubscribeLinkOf(address: string): Promise<string> {
	const [mail] = await messagesTo(address);
	if (mail === undefined) throw new Error(`No mail to ${address}.`);
	const details = await messageDetails(mail.id);
	const [link] = details.unsubscribeLinks;
	if (link === undefined) throw new Error(`The mail to ${address} has no unsubscribe link.`);
	return link;
}

/**
 * Signs Eva in, with an address of her own for Better Auth's rate limiter (as Mia above).
 *
 * @param browser The worker's browser.
 * @returns Her page.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's browser is a handle, mutable by design
async function signInEva(browser: Browser): Promise<Page> {
	const context = await browser.newContext({
		extraHTTPHeaders: { 'x-forwarded-for': '127.0.0.10' },
	});
	const page = await context.newPage();
	await signIn(page, EVA_ADDRESS);
	return page;
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin and the editor see it
test('an editor creates a circular occasion and an admin may not see its recipients', async ({
	browser,
}) => {
	test.setTimeout(FLOW_TIMEOUT_MS);
	// The sender of the tests above sends for „Veranstaltungen“ as well.
	await openSender(admin, SENDER_ADDRESS);
	await releaseTo(admin, EVENTS);
	await admin.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByText('Gespeichert.', { exact: true })).toBeVisible();
	// Eva edits „Veranstaltungen“; now she may send there.
	await admin.goto('/admin/users');
	await admin.getByLabel(`${EVENTS} für Eva`).click();
	await admin.getByRole('option', { name: 'Versenden' }).click();
	await expect(admin.getByRole('status')).toHaveText(`${EVENTS} für Eva: Versenden`);
	for (const partner of COMMITTEE) {
		// oxlint-disable-next-line no-await-in-loop -- one partner after another, as the admin enters them
		await createPartner(admin, partner);
	}

	const eva = await signInEva(browser);
	evaPage = eva;
	await eva
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Anlässe' })
		.click();
	await expect(eva).toHaveTitle('Anlässe – Vereinsbote');
	await expect(eva.getByText('Es gibt noch keine Anlässe.')).toBeVisible();
	await expectNoA11yViolations(eva);
	await eva.getByRole('link', { name: 'Neuer Anlass' }).click();
	await expect(eva).toHaveTitle('Neuer Anlass – Vereinsbote');
	await expect(eva.getByRole('button', { name: 'Anlass anlegen' })).toBeEnabled();
	await expectNoA11yViolations(eva);
	shared.circularId = await createOccasion(eva, {
		kind: 'Rundschreiben',
		name: CIRCULAR,
		sender: SENDER_LABEL,
		template: INVITATION_TEMPLATE,
	});
	await expect(eva).toHaveTitle('Anlass – Vereinsbote');
	// A circular sends the unsubscribe link unless the editor turns it off.
	await expect(eva.getByRole('checkbox', { name: 'Abmeldelink in jeder Mail' })).toBeChecked();
	await expect(eva.getByRole('link', { name: `${CIRCULAR} versenden` })).toBeVisible();
	await expectNoA11yViolations(eva);
	await eva.goto('/occasions');
	await expect(eva.getByRole('row', { name: new RegExp(CIRCULAR, 'u') })).toContainText(
		'Rundschreiben',
	);
	await expectNoA11yViolations(eva);

	// The admin role alone gives no access to the area: no occasion, no send flow, no overview.
	await admin.goto('/occasions');
	await expect(admin.getByRole('heading', { level: 1, name: 'Anlässe' })).toBeVisible();
	await expect(admin.getByText(CIRCULAR)).toHaveCount(0);
	for (const path of [`/occasions/${shared.circularId}`, `/occasions/${shared.circularId}/send`]) {
		// oxlint-disable-next-line no-await-in-loop -- one page after another
		await admin.goto(path);
		// oxlint-disable-next-line no-await-in-loop -- see above
		await expect(admin.getByRole('heading', { level: 1, name: NOT_FOUND })).toBeVisible();
	}
	await admin.goto('/sending');
	await expect(admin.getByRole('heading', { level: 1, name: 'Versand' })).toBeVisible();
	await admin.getByRole('button', { name: /\bBereich\b/u }).click();
	await expect(admin.getByRole('option', { name: 'Finanzen' })).toBeVisible();
	await expect(admin.getByRole('option', { name: EVENTS })).toHaveCount(0);
	await admin.keyboard.press('Escape');
});

// oxlint-disable-next-line max-statements -- one flow through the send flow, step by step
test('a circular goes out once per address with the attachment and unsubscribe headers', async () => {
	test.setTimeout(FLOW_TIMEOUT_MS);
	const eva = signedInEva();
	await openSendFlow(eva, shared.circularId);
	await expect(eva).toHaveTitle('Versenden – Vereinsbote');
	await expectNoA11yViolations(eva);
	const summary = await chooseCommittee(eva);
	// Three partners, two addresses: the family gets one mail.
	await expect(countOf(summary, 'Mails')).toHaveText('2');
	await expect(countOf(summary, MERGED_LABEL)).toHaveText('1');
	await expectNoA11yViolations(eva);

	await nextStep(eva, 'Schritt 2 von 3: Anhänge');
	await expectNoA11yViolations(eva);
	const add = eva.getByRole('button', { name: 'Datei hinzufügen' });
	await expect(add).toBeEnabled();
	const chooser = eva.waitForEvent('filechooser');
	await add.click();
	const fileChooser = await chooser;
	await fileChooser.setFiles({ buffer: PDF_BYTES, mimeType: 'application/pdf', name: PDF_NAME });
	await expect(eva.getByText(`${PDF_NAME} ist angehängt.`)).toBeVisible();
	await expect(
		eva.getByRole('region', { name: 'Anhänge' }).getByText(new RegExp(`^${PDF_NAME} \\(`, 'u')),
	).toBeVisible();
	await expectNoA11yViolations(eva);

	await nextStep(eva, 'Schritt 3 von 3: Vorschau und Testmail');
	await expectNoA11yViolations(eva);
	await eva.getByRole('combobox', { name: 'Kontakt für die Vorschau' }).fill('Tom');
	await eva.getByRole('option', { name: 'Tom Vogel (Partner)' }).click();
	// Hanna has the lower customer number: her values fill the family's mail (Design 11.2).
	await expect(
		eva.getByText(
			'Diese Adresse bekommt eine Mail für Hanna Vogel, Tom Vogel. Sie trägt die Werte von Hanna Vogel.',
		),
	).toBeVisible();
	await expect(
		eva.frameLocator(PREVIEW_FRAME).getByText('Hallo Hanna', { exact: true }),
	).toBeVisible();
	await expectNoA11yViolations(eva, [PREVIEW_FRAME]);
	await eva.getByRole('button', { name: 'Testmail an mich senden' }).click();
	await expect(eva.getByText(`Die Testmail ist unterwegs an ${EVA_ADDRESS}.`)).toBeVisible();
	// The test mail went out within the request, to Eva only.
	const evasMails = await messagesTo(EVA_ADDRESS);
	const testMails = evasMails.filter(({ subject }) => subject.startsWith('[Test]'));
	expect(testMails.map(({ subject }) => subject)).toStrictEqual([
		'[Test] Einladung zu [Veranstaltung]',
	]);
	const testDetails = await messageDetails(testMails[0]?.id ?? '');
	expect(testDetails.attachments).toStrictEqual([
		{ contentType: 'application/pdf', name: PDF_NAME },
	]);
	// Its unsubscribe link changes nothing.
	expect(testDetails.unsubscribeLinks).toStrictEqual([`${E2E_URL}/unsubscribe/test`]);

	const dialog = await openConfirmation(eva, CIRCULAR);
	await expect(countOf(dialog, 'Mails')).toHaveText('2');
	await expect(countOf(dialog, MERGED_LABEL)).toHaveText('1');
	await expect(countOf(dialog, 'Anhänge')).toHaveText(/^Dateien: 1, zusammen /u);
	await expect(countOf(dialog, 'Voraussichtliche Dauer')).toHaveText('etwa 1 Tag (heute)');
	await expectNoA11yViolations(eva);
	await dialog.getByRole('button', { name: 'Jetzt versenden' }).click();
	await expect(eva.getByRole('heading', { level: 1, name: CIRCULAR })).toBeFocused();
	await expect(
		eva.getByText('Die Welle ist angelegt (Mails: 2); die ersten gehen gleich raus.'),
	).toBeVisible();

	// The confirmation started a run at once; a tick on top sends nothing twice.
	await expect.poll(async () => countMailsTo(FAMILY_ADDRESS), { timeout: MAIL_TIMEOUT_MS }).toBe(1);
	await expect.poll(async () => countMailsTo(SINGLE_ADDRESS), { timeout: MAIL_TIMEOUT_MS }).toBe(1);
	await runTick(APP);
	for (const address of [FAMILY_ADDRESS, SINGLE_ADDRESS]) {
		// oxlint-disable-next-line no-await-in-loop -- one address after another
		const mails = await messagesTo(address);
		expect(mails, `one mail to ${address}`).toHaveLength(1);
		// oxlint-disable-next-line no-await-in-loop -- see above
		const details = await messageDetails(mails[0]?.id ?? '');
		expect(details.attachments).toStrictEqual([{ contentType: 'application/pdf', name: PDF_NAME }]);
		expect(details.unsubscribeLinks).toHaveLength(1);
		expect(details.unsubscribeLinks[0]).toMatch(/^http:\/\/localhost:3100\/unsubscribe\/[\w-]+$/u);
		expect(details.unsubscribePost).toBe('List-Unsubscribe=One-Click');
	}

	// The overview of the area: the wave and its entries, the family's one with both names.
	const waves = await openEventsOverview(eva);
	await expectNoA11yViolations(eva);
	await waves.getByRole('link', { name: new RegExp(`^${CIRCULAR},`, 'u') }).click();
	await expect(eva.getByRole('heading', { level: 1, name: `Welle: ${CIRCULAR}` })).toBeVisible();
	await expect(eva).toHaveTitle('Welle – Vereinsbote');
	shared.waveUrl = new URL(eva.url()).pathname;
	const entries = eva.getByRole('grid', { name: 'Einträge der Welle' });
	const family = entries.getByRole('row', { name: /Hanna Vogel/u });
	await expect(async () => {
		await eva.reload();
		await expect(family).toContainText('Gesendet', { timeout: ANSWER_WAIT_MS });
	}).toPass({ timeout: MAIL_TIMEOUT_MS });
	await expect(family).toContainText(FAMILY_ADDRESS);
	await expect(family).toContainText('und 1 weiterer Kontakt an dieser Adresse');
	await expect(entries.getByRole('row', { name: /Ines Brenner/u })).toContainText('Gesendet');
	await expectNoA11yViolations(eva);

	// The admin may not open the wave.
	await admin.goto(shared.waveUrl);
	await expect(admin.getByRole('heading', { level: 1, name: NOT_FOUND })).toBeVisible();
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as the recipient and Eva see it
test('a recipient unsubscribes from the area, undoes it and unsubscribes again', async ({
	browser,
}) => {
	const eva = signedInEva();
	const link = await unsubscribeLinkOf(SINGLE_ADDRESS);
	// The recipient's browser: no session, no cookie of the app.
	const context = await browser.newContext();
	const page = await context.newPage();
	const opened = await page.goto(link);
	expect(opened?.status()).toBe(HTTP_OK);
	await expect(page).toHaveTitle('Abmelden – Vereinsbote');
	const submit = page.getByRole('button', { name: 'Abmelden' });
	await expect(submit).toBeEnabled();
	// The page names the occasion and its area, never the person.
	await expect(page.getByText(`Nur „${CIRCULAR}“`, { exact: true })).toBeVisible();
	const wholeArea = page.getByText(`Alle Mails aus „${EVENTS}“`, { exact: true });
	await expect(wholeArea).toBeVisible();
	await expect(page.locator('body')).not.toContainText('Brenner');
	await expect(page.locator('body')).not.toContainText(SINGLE_ADDRESS);
	await expectNoA11yViolations(page);
	// Opening the page again, as a mail scanner would, changes nothing either.
	await page.reload();
	await expect(submit).toBeEnabled();
	await openSendFlow(eva, shared.circularId);
	const before = await chooseCommittee(eva);
	await expect(countOf(before, 'Mails')).toHaveText('2');
	await expect(before.getByText('Ausgeschlossen, vom Bereich abgemeldet')).toHaveCount(0);

	await wholeArea.click();
	await submit.click();
	const done = page.getByText(`Du bist von allen Mails aus „${EVENTS}“ abgemeldet.`);
	await expect(done).toBeFocused();
	await expectNoA11yViolations(page);
	await page.getByRole('button', { name: 'Rückgängig' }).click();
	await expect(
		page.getByText('Die Abmeldung ist rückgängig gemacht. Du kannst dich wieder abmelden.'),
	).toBeFocused();
	await expectNoA11yViolations(page);
	await wholeArea.click();
	await submit.click();
	await expect(done).toBeFocused();
	await context.close();

	// The next wave of the area leaves Ines out.
	await openSendFlow(eva, shared.circularId);
	const after = await chooseCommittee(eva);
	await expect(countOf(after, 'Mails')).toHaveText('1');
	await expect(countOf(after, 'Ausgeschlossen, vom Bereich abgemeldet')).toHaveText('1');

	// The link of a test mail changes nothing, and a link that does not open names nothing.
	const visitor = await browser.newContext();
	const other = await visitor.newPage();
	await other.goto('/unsubscribe/test');
	await expect(
		other.getByRole('heading', { level: 1, name: 'Testmail – nichts geändert' }),
	).toBeVisible();
	await expectNoA11yViolations(other);
	const invalid = await other.goto('/unsubscribe/kein-gueltiger-link');
	expect(invalid?.status()).toBe(HTTP_NOT_FOUND);
	await expect(other.getByRole('heading', { level: 1, name: 'Link ungültig' })).toBeVisible();
	await expectNoA11yViolations(other);
	await visitor.close();
});

// oxlint-disable-next-line max-statements -- the provider's post, then what Eva's next wave counts
test('one-click unsubscribe works without cookies', async ({ request }) => {
	const link = await unsubscribeLinkOf(FAMILY_ADDRESS);
	// What a mail provider posts (RFC 8058): no cookie, no `Origin`, only the field.
	const response = await request.post(link, { form: { 'List-Unsubscribe': 'One-Click' } });
	expect(response.status()).toBe(HTTP_OK);
	expect(await response.text()).toBe('');

	// Both contacts at the family's address are opted out of the occasion.
	const eva = signedInEva();
	await openSendFlow(eva, shared.circularId);
	const summary = await chooseCommittee(eva);
	await expect(countOf(summary, 'Ausgeschlossen, von diesem Anlass abgemeldet')).toHaveText('2');
	await expect(countOf(summary, 'Ausgeschlossen, vom Bereich abgemeldet')).toHaveText('1');
	await expect(countOf(summary, 'Mails')).toHaveText('0');
	await expect(summary.getByText('Diese Auswahl ergibt keine Mail.')).toBeVisible();
});

/**
 * The mails of the waves of the sender with the daily limit, without its self test to the admin.
 *
 * @returns The mails, oldest first.
 */
async function limitedMails(): Promise<ListedMessage[]> {
	const messages = await listMessages();
	return messages.filter(({ from, to }) => from === LIMIT_ADDRESS && !to.includes(ADMIN_ADDRESS));
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as the admin and Eva see it
test('personal mails go first under a small daily limit', async () => {
	test.setTimeout(FLOW_TIMEOUT_MS);
	// A sender of its own, with a limit of 1: its self test (a mail to the admin) uses it up today.
	await admin.goto('/admin/sending');
	await admin.getByRole('link', { name: 'Absender anlegen' }).click();
	await expect(admin.getByRole('button', { name: 'Anlegen' })).toBeEnabled();
	await admin.getByLabel('Absenderadresse').fill(LIMIT_ADDRESS);
	await admin.getByLabel('Anzeigename').fill(LIMIT_NAME);
	await admin.getByLabel('Tageslimit').fill('1');
	await releaseTo(admin, EVENTS);
	await admin.getByRole('button', { name: 'Anlegen' }).click();
	await expect(admin.getByRole('heading', { level: 1, name: LIMIT_ADDRESS })).toBeVisible();
	await expect(admin.getByRole('region', { name: 'Ergebnis des Selbsttests' })).toContainText(
		'Testmail verschickt',
	);

	// A circular to five members first, then personal mails to two: both wait for the limit.
	const eva = signedInEva();
	const limitLabel = `${LIMIT_NAME} <${LIMIT_ADDRESS}>`;
	const news = 'Kurzmeldung';
	const greeting = 'Persönlicher Gruß';
	const newsId = await createOccasion(eva, {
		kind: 'Rundschreiben',
		name: news,
		sender: limitLabel,
		template: NEWSLETTER_TEMPLATE,
	});
	const greetingId = await createOccasion(eva, {
		kind: 'Persönlich',
		name: greeting,
		sender: limitLabel,
		template: NEWSLETTER_TEMPLATE,
	});
	await openSendFlow(eva, newsId);
	await pickMembers(eva, CIRCULAR_PICKS);
	await expectNoA11yViolations(eva);
	await sendNow(eva, news, CIRCULAR_PICKS.length);
	await openSendFlow(eva, greetingId);
	await pickMembers(eva, PERSONAL_PICKS);
	await sendNow(eva, greeting, PERSONAL_PICKS.length);
	expect(await limitedMails()).toStrictEqual([]);

	// Room for three more mails today; one tick sends them, the personal ones first.
	await openSender(admin, LIMIT_ADDRESS);
	await admin.getByLabel('Tageslimit').fill('4');
	await admin.getByRole('button', { name: 'Speichern' }).click();
	await expect(admin.getByText('Gespeichert.', { exact: true })).toBeVisible();
	await runTick(APP);
	await expect
		.poll(
			async () => {
				const mails = await limitedMails();
				return mails.length;
			},
			{ timeout: MAIL_TIMEOUT_MS },
		)
		.toBe(3);
	const limited = await limitedMails();
	const sent = limited.map(({ to }) => to.join(','));
	expect(sent.slice(0, PERSONAL_PICKS.length).toSorted()).toStrictEqual(
		PERSONAL_PICKS.map(([, address]) => address).toSorted(),
	);
	expect(CIRCULAR_PICKS.map(([, address]) => address)).toContain(sent[PERSONAL_PICKS.length]);

	// The rest of the circular waits for the next day.
	const waves = await openEventsOverview(eva);
	await expect(waves.getByRole('row', { name: new RegExp(`^${news},`, 'u') })).toContainText(
		'Gesendet: 1, Geplant: 4',
	);
	await expect(waves.getByRole('row', { name: new RegExp(`^${greeting},`, 'u') })).toContainText(
		'Gesendet: 2',
	);
});

/**
 * Creates a Resend connection with a webhook signing secret, as the admin does.
 *
 * @param page The admin's page.
 * @returns The connection's id, the last part of the webhook's address.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function createResendConnection(page: Page): Promise<string> {
	await page.goto('/admin/sending');
	await page.getByRole('link', { name: 'Anbindung anlegen' }).click();
	const create = page.getByRole('button', { name: 'Anlegen' });
	await expect(create).toBeEnabled();
	await choose(page, { label: 'Art der Anbindung', option: 'Resend' });
	for (const [label, value] of [
		['Name', RESEND_CONNECTION],
		['API-Key', 're_e2e_only_key'],
		['Webhook-Signing-Secret', WEBHOOK_SECRET],
	] as const) {
		// oxlint-disable-next-line no-await-in-loop -- one field after another, as a user types
		await page.getByLabel(label, { exact: true }).fill(value);
	}
	await create.click();
	await expect(page).toHaveURL(CONNECTION_PAGE);
	return CONNECTION_PAGE.exec(page.url())?.groups?.id ?? '';
}

/**
 * Creates a sender of the Resend connection released to „Veranstaltungen“; its self test sends a
 * test mail to the admin at once.
 *
 * @param page The admin's page.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see choose
async function createResendSender(page: Page): Promise<void> {
	await page.goto('/admin/sending');
	await page.getByRole('link', { name: 'Absender anlegen' }).click();
	const create = page.getByRole('button', { name: 'Anlegen' });
	await expect(create).toBeEnabled();
	await choose(page, { label: 'Anbindung', option: RESEND_CONNECTION });
	await page.getByLabel('Absenderadresse').fill(RESEND_ADDRESS);
	await page.getByLabel('Anzeigename').fill(RESEND_NAME);
	await releaseTo(page, EVENTS);
	await create.click();
	await expect(page.getByRole('region', { name: 'Ergebnis des Selbsttests' })).toContainText(
		'Testmail verschickt',
	);
}

/**
 * Sends a newsletter through Resend to one member and has Resend report it as a hard bounce by
 * its webhook, signed with the connection's secret, once the outbox has stored Resend's id.
 *
 * @param eva Eva's page.
 * @param connectionId The Resend connection.
 */
// oxlint-disable-next-line max-statements, typescript/prefer-readonly-parameter-types -- one flow, step by step; see choose
async function bounceThroughResend(eva: Page, connectionId: string): Promise<void> {
	const occasion = await createOccasion(eva, {
		kind: 'Rundschreiben',
		name: RESEND_NAME,
		sender: `${RESEND_NAME} <${RESEND_ADDRESS}>`,
		template: NEWSLETTER_TEMPLATE,
	});
	await openSendFlow(eva, occasion);
	await pickMembers(eva, [RESEND_BOUNCE]);
	await sendNow(eva, RESEND_NAME, 1);
	// The overview loads its numbers once; it is opened anew until the run has stored the answer.
	await expect(async () => {
		const waves = await openEventsOverview(eva);
		await expect(
			waves.getByRole('row', { name: new RegExp(`^${RESEND_NAME},`, 'u') }),
		).toContainText('Gesendet: 1', { timeout: ANSWER_WAIT_MS });
	}).toPass({ timeout: MAIL_TIMEOUT_MS });
	const accepted = await resendMails();
	const mail = accepted.find(({ to }) => to.includes(RESEND_BOUNCE[1]));
	const status = await sendResendWebhook({
		appUrl: E2E_URL,
		connectionId,
		emailId: mail?.id ?? '',
		hard: true,
		secret: WEBHOOK_SECRET,
		type: 'bounce',
	});
	expect(status).toBe(HTTP_OK);
}

// oxlint-disable-next-line max-statements -- one flow, step by step, as Eva sees it
test('a hard bounce marks the contacts and an editor clears the marking', async () => {
	test.setTimeout(FLOW_TIMEOUT_MS);
	const eva = signedInEva();
	// Graph: the tick reads the sender's inbox, readable now; the report names the mail that bounced.
	const [family] = await messagesTo(FAMILY_ADDRESS);
	const { messageId } = await messageDetails(family?.id ?? '');
	await setSenders([SENDER_ADDRESS]);
	await addNdr({ hard: true, mailbox: SENDER_ADDRESS, originalMessageId: `<${messageId}>` });
	await runTick(APP);
	await setSenders([]);
	// Resend reports by a webhook, which needs no tick.
	const connectionId = await createResendConnection(admin);
	await createResendSender(admin);
	await bounceThroughResend(eva, connectionId);

	await eva.goto(shared.waveUrl);
	const entry = eva.getByRole('grid', { name: 'Einträge der Welle' }).getByRole('row', {
		name: /Hanna Vogel/u,
	});
	await expect(entry).toContainText('Zurückgewiesen');
	await expect(entry).toContainText(
		'Rückläufer: Die Adresse gibt es nicht oder sie nimmt keine Mails an.',
	);

	// Both contacts at the family's address are marked „E-Mail ungültig“, and the member of the
	// Resend mail.
	await openEventsOverview(eva);
	const bounces = eva.getByRole('grid', { name: `Rückläufer in ${EVENTS}` });
	await expect(bounces.getByRole('row', { name: /Hanna Vogel/u })).toContainText(FAMILY_ADDRESS);
	await expect(bounces.getByRole('row', { name: /Tom Vogel/u })).toContainText(FAMILY_ADDRESS);
	await expect(bounces.getByRole('row', { name: new RegExp(RESEND_BOUNCE[0], 'u') })).toContainText(
		RESEND_BOUNCE[1],
	);
	await expect(
		eva.getByRole('navigation', { name: 'Hauptnavigation' }).getByText('3 Rückläufer'),
	).toBeVisible();
	await expectNoA11yViolations(eva);
	await bounces.getByRole('button', { name: 'Markierung aufheben für Hanna Vogel' }).click();
	await expect(
		eva.getByText('Die Markierung „E-Mail ungültig“ von Hanna Vogel ist aufgehoben.'),
	).toBeVisible();
	await expect(bounces.getByRole('row', { name: /Hanna Vogel/u })).toHaveCount(0);
	await expectNoA11yViolations(eva);

	// Tom's mark stays; his page shows it, and it can be cleared there as well.
	await bounces.getByRole('link', { name: 'Tom Vogel' }).click();
	await expect(eva.getByRole('heading', { level: 1, name: 'Tom Vogel' })).toBeVisible();
	await expect(eva.getByRole('heading', { name: 'E-Mail ungültig' })).toBeVisible();
	await expectNoA11yViolations(eva);
	await eva.getByRole('button', { name: 'Markierung aufheben' }).click();
	await expect(eva.getByText('Die Markierung „E-Mail ungültig“ ist aufgehoben.')).toBeVisible();
	await expect(eva.getByRole('heading', { name: 'E-Mail ungültig' })).toHaveCount(0);
});

// oxlint-disable-next-line max-statements -- one flow, step by step, as Eva sees it
test('a wave can be stopped', async () => {
	test.setTimeout(FLOW_TIMEOUT_MS);
	const eva = signedInEva();
	await openSendFlow(eva, shared.circularId);
	await choose(eva, { label: 'Gruppe', option: 'Tischtennis' });
	await expect(countOf(eva.getByRole('region', { name: 'Diese Welle' }), 'Mails')).toHaveText(
		String(TABLE_TENNIS_ADDRESSES.length),
	);
	await nextStep(eva, 'Schritt 2 von 3: Anhänge');
	await nextStep(eva, 'Schritt 3 von 3: Vorschau und Testmail');
	const dialog = await openConfirmation(eva, CIRCULAR);
	await dialog
		.getByRole('radiogroup', { name: 'Wann?' })
		.getByText('Geplant', { exact: true })
		.click();
	await typeDate(dialog.getByRole('group', { name: 'Datum und Uhrzeit' }), clubClockAhead(HOUR_MS));
	await expectNoA11yViolations(eva);

	// The answer to the first confirmation is lost on its way back (the wave was made): the dialog
	// stays open and says so, and confirming again gets the same wave, not a second one.
	let failNext = true;
	await eva.route('**/_serverFn/**', async (route) => {
		if (failNext && (route.request().postData() ?? '').includes('requestId')) {
			failNext = false;
			await route.fetch();
			await route.fulfill({ body: '', status: 500 });
			return;
		}
		await route.fallback();
	});
	const plan = dialog.getByRole('button', { name: 'Versand planen' });
	await plan.click();
	await expect(dialog.getByRole('alert')).toHaveText(
		'Das hat nicht geklappt. Bitte versuche es noch einmal.',
	);
	await expectNoA11yViolations(eva);
	await eva.unrouteAll();
	await plan.click();
	await expect(eva.getByRole('heading', { level: 1, name: CIRCULAR })).toBeFocused();
	await expect(
		eva.getByText(/^Die Welle ist angelegt \(Mails: 6\); der Versand beginnt am /u),
	).toBeVisible();

	const waves = await openEventsOverview(eva);
	const planned = waves.getByRole('row', { name: new RegExp(`^${CIRCULAR},`, 'u') }).filter({
		hasText: 'Geplant',
	});
	await expect(planned).toHaveCount(1);
	await planned.getByRole('link').click();
	await expect(eva.getByRole('heading', { level: 1, name: `Welle: ${CIRCULAR}` })).toBeVisible();
	await expect(eva.getByRole('button', { name: 'Welle stoppen' })).toBeEnabled();
	await expectNoA11yViolations(eva);
	await eva.getByRole('button', { name: 'Welle stoppen' }).click();
	const stop = eva.getByRole('dialog', { name: `Welle „${CIRCULAR}“ stoppen?` });
	await expect(stop).toBeVisible();
	await expectNoA11yViolations(eva);
	await stop.getByRole('button', { name: 'Welle stoppen' }).click();
	await expect(
		eva.getByText('Die Welle ist gestoppt. 6 geplante Mails wurden abgebrochen.'),
	).toBeVisible();
	await expect(eva.getByRole('heading', { level: 1, name: `Welle: ${CIRCULAR}` })).toBeFocused();
	await expect(eva.getByRole('button', { name: 'Welle stoppen' })).toHaveCount(0);
	const entries = eva.getByRole('grid', { name: 'Einträge der Welle' });
	await expect(entries.getByRole('row').filter({ hasText: 'Abgebrochen' })).toHaveCount(
		TABLE_TENNIS_ADDRESSES.length,
	);
	await expectNoA11yViolations(eva);

	// A tick sends nothing of it.
	await runTick(APP);
	const mails = await Promise.all(
		TABLE_TENNIS_ADDRESSES.map(async (address) => messagesTo(address)),
	);
	expect(mails.flat()).toStrictEqual([]);
});

test('a template used by an occasion cannot be deleted', async () => {
	const eva = signedInEva();
	await eva.goto('/templates');
	await eva.getByRole('button', { name: `${INVITATION_TEMPLATE} löschen` }).click();
	const dialog = eva.getByRole('dialog', { name: `„${INVITATION_TEMPLATE}“ löschen?` });
	await dialog.getByRole('button', { name: 'Endgültig löschen' }).click();
	await expect(eva.getByRole('alert')).toHaveText(
		`Die Vorlage wird von diesen Anlässen genutzt und lässt sich nicht löschen: ${CIRCULAR}`,
	);
	await expect(
		eva
			.getByRole('grid', { name: 'Vorlagen' })
			.getByRole('link', { exact: true, name: INVITATION_TEMPLATE }),
	).toBeVisible();
	await expectNoA11yViolations(eva);
});
