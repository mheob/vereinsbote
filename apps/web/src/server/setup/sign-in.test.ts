import { describe, expect, it, vi } from 'vite-plus/test';

import { createAuth, createSessionFor } from '@/server/auth/auth';
import { getSessionUser } from '@/server/auth/session';
import type { Db } from '@/server/db/client';
import { session, user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { parseEnv } from '@/server/env';
import { CapturingMailer } from '@/server/mail/testing';
import { getState } from '@/server/system-state';

import {
	completeSetupAndSignIn,
	hasSetupSession,
	isSetupDone,
	SetupAlreadyDoneError,
	SetupDisabledError,
	SetupTokenInvalidError,
} from './setup';

const TOKEN = 't'.repeat(24);

const input = {
	adminEmail: ' Admin@Verein.de',
	adminName: 'Alex',
	expectedToken: TOKEN,
	token: TOKEN,
};

type OpenSession = (adminUserId: string) => Promise<void>;

const opensSession = (): ReturnType<typeof vi.fn<OpenSession>> =>
	vi.fn<OpenSession>().mockResolvedValue();

const failsToOpenSession = (): ReturnType<typeof vi.fn<OpenSession>> =>
	vi.fn<OpenSession>().mockRejectedValue(new Error('session store down'));

/**
 * Whether the setup admin's first session has been opened.
 *
 * @param db The database.
 * @returns True once the recovery path is closed.
 */
async function sessionOpened(db: Db): Promise<boolean> {
	return (await getState(db, 'setup_session_opened_at')) !== null;
}

/**
 * Completes the setup, but the session cannot be opened afterwards.
 *
 * @param db The database.
 * @returns The id of the admin the setup created.
 */
async function setUpWithFailedSession(db: Db): Promise<string> {
	const failing = failsToOpenSession();
	await expect(completeSetupAndSignIn(db, input, failing)).rejects.toThrow('session store down');
	const [adminUserId] = failing.mock.calls[0] ?? [];
	if (adminUserId === undefined) throw new Error('No session was attempted.');
	return adminUserId;
}

/**
 * The reasons of the rejected results.
 *
 * @param results The settled results.
 * @returns The rejection reasons, in order.
 */
function rejectionsOf(results: readonly Readonly<PromiseSettledResult<unknown>>[]): unknown[] {
	const reasons: unknown[] = [];
	for (const result of results) {
		if (result.status === 'rejected') {
			const reason: unknown = result.reason;
			reasons.push(reason);
		}
	}
	return reasons;
}

/**
 * Request headers that carry the cookie of a `Set-Cookie` value.
 *
 * @param setCookie The `Set-Cookie` value of the session.
 * @returns The headers.
 */
function cookieHeaders(setCookie: string): Headers {
	return new Headers({ cookie: setCookie.split(';')[0] ?? '' });
}

describe(hasSetupSession, () => {
	it('is true only once the setup admin got a session, so /setup keeps its form until then', async () => {
		const db = await createTestDb();
		await expect(hasSetupSession(db)).resolves.toBe(false);
		await setUpWithFailedSession(db);
		await expect(hasSetupSession(db)).resolves.toBe(false);
		await completeSetupAndSignIn(db, input, opensSession());
		await expect(hasSetupSession(db)).resolves.toBe(true);
	});
});

describe(completeSetupAndSignIn, () => {
	it('opens the session of the new admin and then closes the recovery path', async () => {
		const db = await createTestDb();
		const open = vi.fn<OpenSession>(async () => {
			// The marker is written only after the session exists.
			await expect(sessionOpened(db)).resolves.toBe(false);
		});
		const { adminUserId } = await completeSetupAndSignIn(db, input, open);
		expect(open).toHaveBeenCalledExactlyOnceWith(adminUserId);
		await expect(sessionOpened(db)).resolves.toBe(true);
	});

	it('keeps the setup but not the marker when the session cannot be opened', async () => {
		const db = await createTestDb();
		await setUpWithFailedSession(db);
		await expect(isSetupDone(db)).resolves.toBe(true);
		await expect(sessionOpened(db)).resolves.toBe(false);
	});

	it('opens the session on a retry with the same token and the admin address', async () => {
		const db = await createTestDb();
		const adminUserId = await setUpWithFailedSession(db);
		const open = opensSession();
		await expect(
			completeSetupAndSignIn(
				db,
				{ ...input, adminEmail: 'ADMIN@verein.de ', adminName: 'X' },
				open,
			),
		).resolves.toStrictEqual({ adminUserId });
		expect(open).toHaveBeenCalledExactlyOnceWith(adminUserId);
		await expect(sessionOpened(db)).resolves.toBe(true);
	});

	it('refuses a retry with another address', async () => {
		const db = await createTestDb();
		await setUpWithFailedSession(db);
		const open = opensSession();
		await expect(
			completeSetupAndSignIn(db, { ...input, adminEmail: 'other@verein.de' }, open),
		).rejects.toBeInstanceOf(SetupAlreadyDoneError);
		expect(open).not.toHaveBeenCalled();
		await expect(sessionOpened(db)).resolves.toBe(false);
	});

	it('refuses every retry once the session was opened', async () => {
		const db = await createTestDb();
		await completeSetupAndSignIn(db, input, opensSession());
		const open = opensSession();
		await expect(completeSetupAndSignIn(db, input, open)).rejects.toBeInstanceOf(
			SetupAlreadyDoneError,
		);
		expect(open).not.toHaveBeenCalled();
	});

	it('never reaches the recovery with a wrong or missing token', async () => {
		const db = await createTestDb();
		await setUpWithFailedSession(db);
		const open = opensSession();
		await expect(
			completeSetupAndSignIn(db, { ...input, token: 'x'.repeat(24) }, open),
		).rejects.toBeInstanceOf(SetupTokenInvalidError);
		await expect(
			completeSetupAndSignIn(db, { ...input, expectedToken: null }, open),
		).rejects.toBeInstanceOf(SetupDisabledError);
		expect(open).not.toHaveBeenCalled();
		await expect(sessionOpened(db)).resolves.toBe(false);
	});

	it('survives a double submission of the retry', async () => {
		const db = await createTestDb();
		const adminUserId = await setUpWithFailedSession(db);
		const open = opensSession();
		const results = await Promise.allSettled([
			completeSetupAndSignIn(db, input, open),
			completeSetupAndSignIn(db, input, open),
		]);
		// One opens the session; the other either opens one too or finds the way closed.
		expect(results).toContainEqual({ status: 'fulfilled', value: { adminUserId } });
		expect(rejectionsOf(results).every((reason) => reason instanceof SetupAlreadyDoneError)).toBe(
			true,
		);
		expect(open.mock.calls.flat().every((id) => id === adminUserId)).toBe(true);
		await expect(sessionOpened(db)).resolves.toBe(true);
	});

	it('creates exactly one admin when the first submission is sent twice', async () => {
		const db = await createTestDb();
		const open = opensSession();
		const results = await Promise.allSettled([
			completeSetupAndSignIn(db, input, open),
			completeSetupAndSignIn(db, input, open),
		]);
		// Whichever comes second finds the setup done; it may still open the admin's session.
		expect(results.map((r) => r.status)).toContain('fulfilled');
		expect(rejectionsOf(results).every((reason) => reason instanceof SetupAlreadyDoneError)).toBe(
			true,
		);
		await expect(db.select().from(user)).resolves.toHaveLength(1);
		await expect(sessionOpened(db)).resolves.toBe(true);
	});

	it('yields a real Better Auth session on the retry after the opening failed', async () => {
		const db = await createTestDb();
		const env = parseEnv({
			APP_SECRET: Buffer.alloc(32, 3).toString('base64'),
			APP_URL: 'https://bote.example.org',
			CRON_SECRET: 'c'.repeat(32),
			DATABASE_URL: 'postgres://x@localhost/x',
		});
		const auth = await createAuth({ db, env, mailer: new CapturingMailer() });
		const adminUserId = await setUpWithFailedSession(db);
		let setCookie = '';
		await completeSetupAndSignIn(db, input, async (userId) => {
			({ setCookie } = await createSessionFor(auth, userId));
		});
		await expect(getSessionUser(auth, db, cookieHeaders(setCookie))).resolves.toMatchObject({
			email: 'admin@verein.de',
			id: adminUserId,
			isAdmin: true,
		});
		await expect(db.select().from(session)).resolves.toHaveLength(1);
	});
});
