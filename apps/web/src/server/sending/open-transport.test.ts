import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { setUpClub, userWith } from '@/server/contacts/testing';
import { auditLog, mailConnections } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';

import { SenderInvalidError, SenderNotFoundError } from './errors';
import { openSenderTransport, runSelfTest } from './open-transport';
import { fakeProviders, graphConnection, resendConnection, senderOn, testEnv } from './testing';

const NOW = new Date('2026-11-25T10:00:00Z');
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_UNAUTHORIZED = 401;
const DISTURBED_SINCE = new Date('2026-11-20T00:00:00Z');

/**
 * A club with a Graph sender whose connection is marked disturbed.
 *
 * @returns The database, the admin and the ids.
 */
async function disturbedGraphClub(): Promise<{
	db: Awaited<ReturnType<typeof createTestDb>>;
	admin: Awaited<ReturnType<typeof setUpClub>>['admin'];
	connectionId: string;
	senderId: string;
}> {
	const db = await createTestDb();
	const { admin } = await setUpClub(db);
	const connectionId = await graphConnection(db, admin);
	const senderId = await senderOn(db, admin, connectionId, 'verein@example.org');
	await db
		.update(mailConnections)
		.set({ disturbedCode: 'graph.unauthorized', disturbedSince: DISTURBED_SINCE })
		.where(eq(mailConnections.id, connectionId));
	return { admin, connectionId, db, senderId };
}

describe(openSenderTransport, () => {
	it('opens a graph transport with scope sender:<id>', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const graphId = await graphConnection(db, admin);
		const sender = await senderOn(db, admin, graphId, 'graph@example.org');
		const opened = await openSenderTransport(db, testEnv(), sender, {
			fetch: fakeProviders().fetch,
			now: () => NOW,
		});
		expect(opened).toMatchObject({
			connectionId: graphId,
			dailyLimit: null,
			perMinute: 30,
			scope: `sender:${sender}`,
		});
		expect(opened.transport.probe).not.toBeNull();
	});

	it('opens a resend transport with scope connection:<id> and the limits of the connection', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const resendId = await resendConnection(db, admin);
		const sender = await senderOn(db, admin, resendId, 'resend@example.org');
		const opened = await openSenderTransport(db, testEnv(), sender, {
			fetch: fakeProviders().fetch,
			now: () => NOW,
		});
		expect(opened).toMatchObject({
			connectionId: resendId,
			dailyLimit: 100,
			perMinute: 60,
			scope: `connection:${resendId}`,
		});
		expect(opened.sender.email).toBe('resend@example.org');
		expect(opened.transport.probe).toBeNull();
	});

	it('uses the default limit of a resend account when the connection sets none', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const resendId = await resendConnection(db, admin);
		await db
			.update(mailConnections)
			.set({ dailyLimit: null, perMinute: null })
			.where(eq(mailConnections.id, resendId));
		const sender = await senderOn(db, admin, resendId, 'resend@example.org');
		const opened = await openSenderTransport(db, testEnv(), sender, {
			fetch: fakeProviders().fetch,
			now: () => NOW,
		});
		expect(opened.perMinute).toBe(600);
		expect(opened.dailyLimit).toBeNull();
	});

	it('refuses an unknown sender', async () => {
		const db = await createTestDb();
		await expect(
			openSenderTransport(db, testEnv(), UNKNOWN_ID, {
				fetch: fakeProviders().fetch,
				now: () => NOW,
			}),
		).rejects.toThrow(SenderNotFoundError);
	});
});

describe(runSelfTest, () => {
	it('runs the self test and stores the restriction result', async () => {
		const { admin, connectionId, db, senderId } = await disturbedGraphClub();
		const restricted = fakeProviders({ probe: HTTP_FORBIDDEN });
		const outcome = await runSelfTest(db, testEnv(), admin, senderId, null, {
			fetch: restricted.fetch,
			now: () => NOW,
		});
		expect(outcome).toStrictEqual({ restriction: 'restricted', testMail: 'sent', token: 'ok' });
		const [stored] = await db
			.select()
			.from(mailConnections)
			.where(eq(mailConnections.id, connectionId));
		expect(stored).toMatchObject({ restriction: 'restricted', restrictionCheckedAt: NOW });
	});

	it('mails the sender address to the admin and probes the admin mailbox by default', async () => {
		const { admin, db, senderId } = await disturbedGraphClub();
		const providers = fakeProviders();
		await runSelfTest(db, testEnv(), admin, senderId, null, {
			fetch: providers.fetch,
			now: () => NOW,
		});
		const urls = providers.calls.map((call) => call.url);
		expect(urls.some((url) => url.endsWith('/users/verein%40example.org/sendMail'))).toBe(true);
		expect(urls.some((url) => url.includes('/users/admin%40example.org/messages'))).toBe(true);
	});

	it('stores a readable restriction for a chosen mailbox and ends the disturbance', async () => {
		const { admin, connectionId, db, senderId } = await disturbedGraphClub();
		const readable = fakeProviders({ probe: HTTP_OK });
		const outcome = await runSelfTest(db, testEnv(), admin, senderId, ' Other@example.org ', {
			fetch: readable.fetch,
			now: () => NOW,
		});
		const [stored] = await db
			.select()
			.from(mailConnections)
			.where(eq(mailConnections.id, connectionId));
		expect(outcome.restriction).toBe('readable');
		expect(
			readable.calls.some((call) => call.url.includes('/users/other%40example.org/messages')),
		).toBe(true);
		expect(stored).toMatchObject({
			disturbedCode: null,
			disturbedSince: null,
			restriction: 'readable',
		});
	});

	it('logs the outcome without any address', async () => {
		const { admin, db, senderId } = await disturbedGraphClub();
		await runSelfTest(db, testEnv(), admin, senderId, 'other@example.org', {
			fetch: fakeProviders().fetch,
			now: () => NOW,
		});
		const entries = await db.select().from(auditLog);
		const logged = entries.filter((entry) => entry.action === 'sender.self_tested');
		expect(logged).toHaveLength(1);
		expect(JSON.stringify(logged)).not.toContain('@');
		expect(logged[0]?.details).toStrictEqual({
			restriction: 'restricted',
			testMail: 'sent',
			token: 'ok',
		});
	});

	it('does not send or clear the disturbance when the token is refused', async () => {
		const { admin, connectionId, db, senderId } = await disturbedGraphClub();
		const refused = fakeProviders({ token: HTTP_UNAUTHORIZED });
		const outcome = await runSelfTest(db, testEnv(), admin, senderId, null, {
			fetch: refused.fetch,
			now: () => NOW,
		});
		const [stored] = await db
			.select()
			.from(mailConnections)
			.where(eq(mailConnections.id, connectionId));
		expect(outcome).toStrictEqual({ restriction: null, testMail: 'failed', token: 'failed' });
		expect(refused.calls.some((call) => call.url.endsWith('/sendMail'))).toBe(false);
		expect(stored?.disturbedSince).toStrictEqual(DISTURBED_SINCE);
	});

	it('reports a refused test mail of a resend sender', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const resendId = await resendConnection(db, admin);
		const senderId = await senderOn(db, admin, resendId, 'resend@example.org');
		const failing = fakeProviders({ send: HTTP_UNAUTHORIZED });
		const outcome = await runSelfTest(db, testEnv(), admin, senderId, null, {
			fetch: failing.fetch,
			now: () => NOW,
		});
		expect(outcome).toStrictEqual({ restriction: null, testMail: 'failed', token: 'ok' });
	});

	it('sends the test mail of a resend sender to the admin', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const resendId = await resendConnection(db, admin);
		const senderId = await senderOn(db, admin, resendId, 'resend@example.org');
		const working = fakeProviders();
		const outcome = await runSelfTest(db, testEnv(), admin, senderId, null, {
			fetch: working.fetch,
			now: () => NOW,
		});
		const sent = working.calls.find((call) => call.url.endsWith('/emails'));
		expect(outcome).toStrictEqual({ restriction: null, testMail: 'sent', token: 'ok' });
		expect(sent?.body).toContain('"to":["admin@example.org"]');
	});

	it('needs an admin', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'send' });
		const connectionId = await graphConnection(db, admin);
		const senderId = await senderOn(db, admin, connectionId, 'verein@example.org');
		await expect(
			runSelfTest(db, testEnv(), editor, senderId, null, {
				fetch: fakeProviders().fetch,
				now: () => NOW,
			}),
		).rejects.toThrow(ForbiddenError);
	});

	it('refuses an unknown sender and an invalid probe address', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const senderId = await senderOn(db, admin, connectionId, 'verein@example.org');
		const deps = { fetch: fakeProviders().fetch, now: () => NOW };
		await expect(runSelfTest(db, testEnv(), admin, UNKNOWN_ID, null, deps)).rejects.toThrow(
			SenderNotFoundError,
		);
		await expect(runSelfTest(db, testEnv(), admin, senderId, 'nope', deps)).rejects.toThrow(
			SenderInvalidError,
		);
	});
});
