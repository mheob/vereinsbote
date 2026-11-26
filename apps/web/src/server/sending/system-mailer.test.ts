import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vite-plus/test';
import { z } from 'zod';

import { setUpClub } from '@/server/contacts/testing';
import { encryptSecret, secretAad } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { mailConnections } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';
import type { SmtpMail } from '@/server/mail/smtp-transport';

import { quotaToday } from './quota';
import { clearSystemSender, createSender, setSystemSender } from './senders';
import {
	checkSystemSender,
	createSystemMailer,
	hasSystemSender,
	MailerNotConfiguredError,
	SystemMailNotSentError,
} from './system-mailer';
import type { SystemMail } from './system-mailer';
import { fakeProviders, graphConnection, resendConnection, senderOn, testEnv } from './testing';

/** What the SMTP double was handed. */
const smtp = vi.hoisted(() => ({ sent: [] as SmtpMail[] }));

vi.mock(import('@/server/mail/smtp-transport'), async (importOriginal) => ({
	...(await importOriginal()),
	openSmtpTransport: () => ({
		// oxlint-disable-next-line typescript/require-await, typescript/prefer-readonly-parameter-types -- the double records, it does not send; nodemailer's mail holds a mutable list
		async sendMail(mail: SmtpMail) {
			smtp.sent.push({ ...mail });
		},
	}),
}));

const NOW = new Date('2026-11-25T10:00:00Z');
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_UNAVAILABLE = 503;
const LINK = 'https://bote.example.org/login';

/** The part of Graph's JSON body a test reads. */
const graphBody = z.object({ content: z.string() });
const graphMessage = z.object({ message: z.object({ body: graphBody }) });

const MAIL: SystemMail = {
	content: {
		button: { label: 'Zur Anmeldung', url: LINK },
		heading: 'Willkommen',
		paragraphs: ['Hallo Kim,', 'du wurdest eingeladen.'],
	},
	locale: 'de',
	subject: 'Einladung zum Vereinsbote',
	to: 'kim@example.org',
};

/**
 * A database whose use fails once `end` was called, like the database of a request on Cloudflare
 * after the response.
 *
 * @param db The test database.
 * @returns The database and the function that ends it.
 */
function endable(db: Db): { db: Db; end: () => void } {
	const state = { ended: false };
	const guarded = new Proxy(db, {
		get(target, property): unknown {
			if (state.ended) throw new Error('The request has ended, its database is closed.');
			const value: unknown = Reflect.get(target, property);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	return {
		db: guarded,
		end: () => {
			state.ended = true;
		},
	};
}

/**
 * Sets up a club with a Graph sender that sends the system mails.
 *
 * @param db The test database.
 * @returns The sender's id.
 */
async function addGraphSystemSender(db: Db): Promise<string> {
	const { admin } = await setUpClub(db);
	const connectionId = await graphConnection(db, admin);
	const senderId = await senderOn(db, admin, connectionId, 'verein@example.org');
	await setSystemSender(db, admin, senderId);
	return senderId;
}

/**
 * A club with a Graph sender that sends the system mails.
 *
 * @returns The database and the sender's id.
 */
async function graphSystemSender(): Promise<{ db: Db; senderId: string }> {
	const db = await createTestDb();
	return { db, senderId: await addGraphSystemSender(db) };
}

/**
 * The disturbance of the only connection.
 *
 * @param db The test database.
 * @returns Since when and why it is disturbed.
 */
async function disturbanceOf(db: Db): Promise<{ code: string | null; since: Date | null }> {
	const [row] = await db
		.select({ code: mailConnections.disturbedCode, since: mailConnections.disturbedSince })
		.from(mailConnections);
	return row ?? { code: null, since: null };
}

/**
 * The id of the only connection.
 *
 * @param db The test database.
 * @returns The id.
 * @throws {Error} Without a connection.
 */
async function onlyConnectionId(db: Db): Promise<string> {
	const [row] = await db.select({ id: mailConnections.id }).from(mailConnections);
	if (row === undefined) throw new Error('no connection');
	return row.id;
}

/** The ways a system mail can go: the system sender, `DEV_SMTP_URL`, or none at all. */
const MAILER_PATHS = ['system sender', 'DEV_SMTP_URL', 'none'] as const;

/**
 * Sets up a mailer path: a system sender, `DEV_SMTP_URL`, or neither.
 *
 * @param db The test database.
 * @param path The path.
 * @returns The environment; its app secret matches the stored credentials.
 */
async function setUpPath(db: Db, path: (typeof MAILER_PATHS)[number]): Promise<Env> {
	if (path === 'system sender') await addGraphSystemSender(db);
	if (path !== 'DEV_SMTP_URL') return testEnv();
	return parseEnv({
		APP_SECRET: Buffer.alloc(32, 7).toString('base64'),
		APP_URL: 'https://bote.example.org',
		CRON_SECRET: 'c'.repeat(32),
		DATABASE_URL: 'postgres://x@localhost/x',
		DEV_SMTP_URL: 'smtp://localhost:1025',
	});
}

/**
 * The JSON body of the one request that sent a mail.
 *
 * @param calls The requests the fake providers saw.
 * @param path The end of the send address.
 * @returns The parsed body.
 */
function sentBody(
	calls: readonly Readonly<{ url: string; body: string }>[],
	path: string,
): unknown {
	const sends = calls.filter((call) => call.url.endsWith(path));
	expect(sends).toHaveLength(1);
	return JSON.parse(sends[0]?.body ?? '');
}

describe(createSystemMailer, () => {
	it('sends through the system sender as json without saving and counts it', async () => {
		const { db, senderId } = await graphSystemSender();
		const providers = fakeProviders();
		const mailer = createSystemMailer({
			db,
			env: testEnv(),
			fetch: providers.fetch,
			now: () => NOW,
		});

		await mailer.send(MAIL);

		expect(sentBody(providers.calls, '/sendMail')).toMatchObject({
			message: {
				body: { contentType: 'HTML' },
				subject: 'Einladung zum Vereinsbote',
				toRecipients: [{ emailAddress: { address: 'kim@example.org' } }],
			},
			saveToSentItems: false,
		});
		const { message } = graphMessage.parse(sentBody(providers.calls, '/sendMail'));
		expect(
			['Willkommen', 'lang="de"', `href="${LINK}"`].filter(
				(fragment) => !message.body.content.includes(fragment),
			),
		).toStrictEqual([]);
		await expect(quotaToday(db, `sender:${senderId}`, NOW)).resolves.toMatchObject({ used: 1 });
	});

	it('sends through resend without the archive copy and counts the connection', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await resendConnection(db, admin);
		const { id } = await createSender(db, admin, {
			archiveBcc: 'archiv@example.org',
			areaIds: [],
			connectionId,
			dailyLimit: null,
			displayName: 'Verein',
			email: 'verein@example.org',
			perMinute: null,
			replyTo: 'vorstand@example.org',
		});
		await setSystemSender(db, admin, id);
		const providers = fakeProviders();
		const mailer = createSystemMailer({
			db,
			env: testEnv(),
			fetch: providers.fetch,
			now: () => NOW,
		});

		await mailer.send(MAIL);

		const body = sentBody(providers.calls, '/emails');
		expect(body).toMatchObject({ reply_to: 'vorstand@example.org', to: ['kim@example.org'] });
		expect(JSON.stringify(body)).not.toContain('archiv@example.org');
		await expect(quotaToday(db, `connection:${connectionId}`, NOW)).resolves.toMatchObject({
			used: 1,
		});
	});

	it('does the database work first and delivers after the database has ended', async () => {
		const { db, senderId } = await graphSystemSender();
		const request = endable(db);
		const providers = fakeProviders();
		const mailer = createSystemMailer({
			db: request.db,
			env: testEnv(),
			fetch: providers.fetch,
			now: () => NOW,
		});

		const delivery = await mailer.prepare(MAIL);
		request.end();
		await delivery?.();

		expect(providers.calls.filter((call) => call.url.endsWith('/sendMail'))).toHaveLength(1);
		await expect(quotaToday(db, `sender:${senderId}`, NOW)).resolves.toMatchObject({ used: 1 });
	});

	it('runs the same statements without a mail and counts nothing', async () => {
		const { db, senderId } = await graphSystemSender();
		const providers = fakeProviders();
		const mailer = createSystemMailer({
			db,
			env: testEnv(),
			fetch: providers.fetch,
			now: () => NOW,
		});

		await expect(mailer.prepare(null)).resolves.toBeNull();

		expect(providers.calls).toStrictEqual([]);
		await expect(quotaToday(db, `sender:${senderId}`, NOW)).resolves.toMatchObject({ used: 0 });
	});

	it.each(MAILER_PATHS)(
		'runs the same statements with and without a mail through %s',
		async (path) => {
			const queries: string[] = [];
			const db = await createTestDb({
				logQuery(query) {
					queries.push(query);
				},
			});
			const mailer = createSystemMailer({
				db,
				env: await setUpPath(db, path),
				fetch: fakeProviders().fetch,
				now: () => NOW,
			});

			queries.length = 0;
			// Without a transport the mail fails after the same statements.
			const delivery = await mailer.prepare(MAIL).catch(() => null);
			const withMail = queries.splice(0);
			await expect(mailer.prepare(null)).resolves.toBeNull();

			expect(withMail).not.toStrictEqual([]);
			expect(queries).toStrictEqual(withMail);
			expect(delivery === null).toBe(path === 'none');
		},
	);

	it('throws with the code of the provider when it refuses the mail', async () => {
		const { db } = await graphSystemSender();
		const providers = fakeProviders({ send: HTTP_FORBIDDEN });
		const mailer = createSystemMailer({
			db,
			env: testEnv(),
			fetch: providers.fetch,
			now: () => NOW,
		});

		const failure: unknown = await mailer.send(MAIL).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(SystemMailNotSentError);
		expect(errorLabel(failure)).toMatch(/^graph\./u);
	});

	it.each([
		[{ token: HTTP_UNAUTHORIZED }, 'graph.unauthorized'],
		[{ send: HTTP_FORBIDDEN }, 'graph.mailbox'],
	])(
		'marks the connection disturbed when the provider refuses the credentials (%o)',
		async (behavior, code) => {
			const { db } = await graphSystemSender();
			const providers = fakeProviders(behavior);
			const mailer = createSystemMailer({
				db,
				env: testEnv(),
				fetch: providers.fetch,
				now: () => NOW,
			});

			await expect(mailer.send(MAIL)).rejects.toBeInstanceOf(SystemMailNotSentError);

			await expect(disturbanceOf(db)).resolves.toStrictEqual({ code, since: NOW });
		},
	);

	it('leaves the connection alone when the provider fails for another reason', async () => {
		const { db } = await graphSystemSender();
		const providers = fakeProviders({ send: HTTP_UNAVAILABLE });
		const mailer = createSystemMailer({
			db,
			env: testEnv(),
			fetch: providers.fetch,
			now: () => NOW,
		});

		await expect(mailer.send(MAIL)).rejects.toBeInstanceOf(SystemMailNotSentError);

		await expect(disturbanceOf(db)).resolves.toStrictEqual({ code: null, since: null });
	});

	it('marks the connection disturbed when its secret does not decrypt', async () => {
		const { db } = await graphSystemSender();
		const id = await onlyConnectionId(db);
		const otherKey = await crypto.subtle.importKey(
			'raw',
			new Uint8Array(32).fill(9),
			'AES-GCM',
			false,
			['encrypt'],
		);
		const foreign = await encryptSecret(
			'graph-client-secret-1',
			otherKey,
			secretAad('mail_connections', id, 'secret_ciphertext'),
		);
		await db
			.update(mailConnections)
			.set({ secretCiphertext: foreign })
			.where(eq(mailConnections.id, id));
		const mailer = createSystemMailer({
			db,
			env: testEnv(),
			fetch: fakeProviders().fetch,
			now: () => NOW,
		});

		await expect(mailer.send(MAIL)).rejects.toThrow();

		await expect(disturbanceOf(db)).resolves.toStrictEqual({
			code: 'outbox.credentials',
			since: NOW,
		});
	});

	it('touches no database when a delivery after the response is refused', async () => {
		const { db } = await graphSystemSender();
		const request = endable(db);
		const providers = fakeProviders({ token: HTTP_UNAUTHORIZED });
		const mailer = createSystemMailer({
			db: request.db,
			env: testEnv(),
			fetch: providers.fetch,
			now: () => NOW,
		});

		const delivery = await mailer.prepare(MAIL);
		request.end();

		await expect(delivery?.()).rejects.toBeInstanceOf(SystemMailNotSentError);
	});

	it('uses DEV_SMTP_URL when no system sender exists', async () => {
		const db = await createTestDb();
		smtp.sent.length = 0;
		const env = parseEnv({
			APP_SECRET: Buffer.alloc(32, 3).toString('base64'),
			APP_URL: 'https://bote.example.org',
			CRON_SECRET: 'c'.repeat(32),
			DATABASE_URL: 'postgres://x@localhost/x',
			DEV_SMTP_URL: 'smtp://localhost:1025',
		});
		const providers = fakeProviders();
		const mailer = createSystemMailer({ db, env, fetch: providers.fetch, now: () => NOW });

		await mailer.send(MAIL);
		await mailer.send({ ...MAIL, to: 'anna@example.org' });

		expect(providers.calls).toStrictEqual([]);
		expect(smtp.sent).toHaveLength(2);
		expect(smtp.sent[0]).toMatchObject({
			from: 'Vereinsbote <noreply@bote.example.org>',
			subject: 'Einladung zum Vereinsbote',
			to: 'kim@example.org',
		});
		expect(smtp.sent[0]?.html).toContain('Willkommen');
		expect(smtp.sent[0]?.text).toContain('du wurdest eingeladen.');
	});

	it('throws MailerNotConfiguredError without system sender and smtp', async () => {
		const db = await createTestDb();
		const mailer = createSystemMailer({ db, env: testEnv(), now: () => NOW });
		await expect(mailer.send(MAIL)).rejects.toBeInstanceOf(MailerNotConfiguredError);
		await expect(mailer.prepare(null)).resolves.toBeNull();
	});
});

describe(checkSystemSender, () => {
	it('marks a graph system sender whose token is refused, and clears it once a token comes', async () => {
		const { db } = await graphSystemSender();
		const deps = { fetch: fakeProviders({ token: HTTP_UNAUTHORIZED }).fetch, now: () => NOW };

		await checkSystemSender(db, testEnv(), deps);
		const refused = await disturbanceOf(db);
		await checkSystemSender(db, testEnv(), { ...deps, fetch: fakeProviders().fetch });

		expect(refused).toStrictEqual({ code: 'graph.unauthorized', since: NOW });
		await expect(disturbanceOf(db)).resolves.toStrictEqual({ code: null, since: null });
	});

	it('keeps a refused mailbox, which a token cannot disprove', async () => {
		const { db } = await graphSystemSender();
		await db.update(mailConnections).set({ disturbedCode: 'graph.mailbox', disturbedSince: NOW });
		const providers = fakeProviders();

		await checkSystemSender(db, testEnv(), { fetch: providers.fetch, now: () => NOW });

		await expect(disturbanceOf(db)).resolves.toStrictEqual({ code: 'graph.mailbox', since: NOW });
		expect(providers.calls).toStrictEqual([]);
	});

	it('fetches nothing without a system sender or for resend', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const providers = fakeProviders();
		await checkSystemSender(db, testEnv(), { fetch: providers.fetch, now: () => NOW });
		const connectionId = await resendConnection(db, admin);
		await setSystemSender(db, admin, await senderOn(db, admin, connectionId, 'verein@example.org'));
		await checkSystemSender(db, testEnv(), { fetch: providers.fetch, now: () => NOW });

		expect(providers.calls).toStrictEqual([]);
		await expect(disturbanceOf(db)).resolves.toStrictEqual({ code: null, since: null });
	});
});

describe(hasSystemSender, () => {
	it('tells whether a sender sends the system mails', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await expect(hasSystemSender(db)).resolves.toBe(false);
		const connectionId = await graphConnection(db, admin);
		const senderId = await senderOn(db, admin, connectionId, 'verein@example.org');
		await expect(hasSystemSender(db)).resolves.toBe(false);
		await setSystemSender(db, admin, senderId);
		await expect(hasSystemSender(db)).resolves.toBe(true);
		await clearSystemSender(db, admin, senderId);
		await expect(hasSystemSender(db)).resolves.toBe(false);
	});
});
