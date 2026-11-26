import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { setUpClub } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { auditLog, mailConnections, outboxEntries, systemState } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import type { SystemMail } from '@/server/mail/system-mailer';
import { CapturingMailer } from '@/server/mail/testing';
import { runTick } from '@/server/tick/tick';
import { insertUser } from '@/server/users/repo';

import { graphConnection, resendConnection, senderOn, testEnv } from './testing';
import { SECRET_WARNING_DAYS, createSendingWarningsStep, secretWarningStage } from './warnings';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-25T10:00:00Z');
const WAVE_ID = '00000000-0000-4000-8000-0000000000aa';

function daysAfter(at: Date, days: number): Date {
	return new Date(at.getTime() + days * DAY_MS);
}

async function tickAt(
	db: Db,
	at: Date,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the mailer records into `sent`
	mailer: CapturingMailer,
): Promise<void> {
	await runTick({
		db,
		env: testEnv(),
		now: () => at,
		steps: [createSendingWarningsStep(() => mailer)],
		storage: null,
	});
}

async function expireOn(db: Db, id: string, secretExpiresOn: string): Promise<void> {
	await db.update(mailConnections).set({ secretExpiresOn }).where(eq(mailConnections.id, id));
}

async function setUpGraph(db: Db): Promise<{
	connectionId: string;
	senderId: string;
	admin: Awaited<ReturnType<typeof setUpClub>>['admin'];
}> {
	const { admin } = await setUpClub(db);
	const connectionId = await graphConnection(db, admin, 'Microsoft 365');
	const senderId = await senderOn(db, admin, connectionId, 'verein@example.org');
	return { admin, connectionId, senderId };
}

interface Failure {
	readonly status: 'failed' | 'uncertain';
	readonly claimedAt: Date;
}

async function failEntries(
	db: Db,
	senderId: string,
	entries: readonly Readonly<Failure>[],
): Promise<void> {
	await db.insert(outboxEntries).values(
		entries.map(({ claimedAt, status }) => ({
			claimedAt,
			lastErrorCode: 'graph.unavailable',
			priority: 'group' as const,
			recipient: 'member@example.org',
			senderId,
			source: 'wave' as const,
			sourceId: WAVE_ID,
			status,
		})),
	);
}

describe(secretWarningStage, () => {
	it.each([
		['2026-12-25', '2026-11-25', 30],
		['2026-12-10', '2026-11-25', 30],
		['2026-12-09', '2026-11-25', 14],
		['2026-12-02', '2026-11-25', 7],
		['2026-11-26', '2026-11-25', 1],
		['2026-11-25', '2026-11-25', 1],
		['2026-11-20', '2026-11-25', 1],
		['2026-12-31', '2026-11-25', null],
	])('stage for %s on %s', (expiresOn, today, stage) => {
		expect(secretWarningStage(expiresOn, today)).toBe(stage);
	});

	it('names the four stages', () => {
		expect(SECRET_WARNING_DAYS).toStrictEqual([30, 14, 7, 1]);
	});
});

// The paragraphs of a mail, one per line; empty for none.
function textOf(mail: Readonly<SystemMail> | undefined): string {
	return mail?.content.paragraphs.join('\n') ?? '';
}

// The number of mails sent after each tick of the given instants.
async function sentAfterEach(
	db: Db,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the mailer records into `sent`
	mailer: CapturingMailer,
	instants: readonly string[],
): Promise<number[]> {
	const counts: number[] = [];
	for (const at of instants) {
		// oxlint-disable-next-line no-await-in-loop -- the ticks follow one another
		await tickAt(db, new Date(at), mailer);
		counts.push(mailer.sent.length);
	}
	return counts;
}

async function disturb(db: Db, connectionId: string, since: Date | null): Promise<void> {
	await db
		.update(mailConnections)
		.set({ disturbedCode: since === null ? null : 'graph.unauthorized', disturbedSince: since })
		.where(eq(mailConnections.id, connectionId));
}

async function auditEntries(
	db: Db,
	action: 'sending.digest_sent' | 'sending.disturbance_warned' | 'sending.secret_warned',
): Promise<(typeof auditLog.$inferSelect)[]> {
	return db.select().from(auditLog).where(eq(auditLog.action, action));
}

// A mailer that refuses the mail to one address (or to all, without one) and records the others.
function refusing(
	refused: string | null,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the mailer records into `sent`
	delivered: CapturingMailer,
): CapturingMailer {
	const mailer = new CapturingMailer();
	mailer.send = async (mail) => {
		await (refused === null || mail.to === refused
			? Promise.reject(new Error('The provider refused the mail.'))
			: delivered.send(mail));
	};
	return mailer;
}

async function tickWith(
	db: Db,
	at: string,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the mailer records into `sent`
	mailer: CapturingMailer,
): Promise<void> {
	await runTick({
		db,
		env: testEnv(),
		now: () => new Date(at),
		steps: [createSendingWarningsStep(() => mailer)],
		storage: null,
	});
}

// A mailer whose mails break the activity log once they are sent.
function breakingMailer(db: Db): CapturingMailer {
	const mailer = new CapturingMailer();
	const send = mailer.send.bind(mailer);
	mailer.send = async (mail) => {
		await send(mail);
		// The log is gone by the time the warning is written.
		await db.execute(sql`alter table audit_log rename to audit_log_gone`);
	};
	return mailer;
}

// A club with two senders, on Graph and on Resend, and a capturing mailer.
async function setUpDigest(): Promise<{
	db: Db;
	mailer: CapturingMailer;
	senderId: string;
	resendSenderId: string;
}> {
	const db = await createTestDb();
	const { admin, senderId } = await setUpGraph(db);
	const resendId = await resendConnection(db, admin);
	const resendSenderId = await senderOn(db, admin, resendId, 'news@example.org');
	return { db, mailer: new CapturingMailer(), resendSenderId, senderId };
}

describe(createSendingWarningsStep, () => {
	it('warns each stage once', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await expireOn(db, connectionId, '2026-12-20');
		const counts = await sentAfterEach(db, new CapturingMailer(), [
			'2026-11-25T10:00:00Z',
			'2026-11-26T10:00:00Z',
			'2026-12-08T10:00:00Z',
			'2026-12-08T16:00:00Z',
			'2026-12-19T10:00:00Z',
			'2026-12-20T10:00:00Z',
		]);
		expect(counts).toStrictEqual([1, 1, 2, 2, 3, 3]);
	});

	it('logs each stage by connection id and number only', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await expireOn(db, connectionId, '2026-12-20');
		await sentAfterEach(db, new CapturingMailer(), [
			'2026-11-25T10:00:00Z',
			'2026-12-08T10:00:00Z',
		]);
		const entries = await auditEntries(db, 'sending.secret_warned');
		expect(entries.map((entry) => [entry.target, entry.details])).toStrictEqual([
			[`connection:${connectionId}`, { failed: 0, sent: 1, stage: 30 }],
			[`connection:${connectionId}`, { failed: 0, sent: 1, stage: 14 }],
		]);
	});

	it('mails active admins in their language, naming the connection and the date', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await insertUser(db, {
			email: 'en-admin@example.org',
			isAdmin: true,
			locale: 'en',
			name: 'English Admin',
			status: 'active',
		});
		await insertUser(db, {
			email: 'invited-admin@example.org',
			isAdmin: true,
			name: 'Invited',
			status: 'invited',
		});
		await expireOn(db, connectionId, '2026-12-20');
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		expect(mailer.sent.map((mail) => [mail.to, mail.subject])).toStrictEqual([
			['admin@example.org', 'Das Secret der Anbindung Microsoft 365 läuft bald ab'],
			['en-admin@example.org', 'The secret of the connection Microsoft 365 expires soon'],
		]);
		expect(textOf(mailer.sent[0])).toContain('läuft in 25 Tagen ab (am 20.12.2026)');
		expect(textOf(mailer.sent[1])).toContain('expires in 25 days (on Dec 20, 2026)');
		expect(mailer.sent[0]?.content.button?.url).toBe(
			`https://bote.example.org/admin/sending/connections/${connectionId}`,
		);
		expect(JSON.stringify(mailer.sent)).not.toContain('graph-client-secret');
	});

	it('says tomorrow and expired in the last stage', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await expireOn(db, connectionId, '2026-11-26');
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		expect(textOf(mailer.sent[0])).toContain('läuft morgen ab');
		await expireOn(db, connectionId, '2026-11-24');
		await tickAt(db, NOW, mailer);
		// Still the last stage: it was warned about already, so nothing more goes.
		expect(mailer.sent).toHaveLength(1);
	});

	it('does not warn for a secret that is far off, and starts again after a renewal', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		await expireOn(db, connectionId, '2026-12-01');
		await tickAt(db, NOW, mailer);
		// The admin renews the secret: the connection is quiet, and warns afresh a year later.
		await expireOn(db, connectionId, '2027-12-01');
		await tickAt(db, NOW, mailer);
		await expireOn(db, connectionId, '2026-12-20');
		await tickAt(db, NOW, mailer);
		expect(mailer.sent).toHaveLength(2);
	});

	it('warns once per disturbance and again after a new one', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		await disturb(db, connectionId, NOW);
		const counts = [mailer.sent.length];
		for (const day of [0, 1]) {
			// oxlint-disable-next-line no-await-in-loop -- the ticks follow one another
			await tickAt(db, daysAfter(NOW, day), mailer);
			counts.push(mailer.sent.length);
		}
		await disturb(db, connectionId, null);
		await tickAt(db, daysAfter(NOW, 2), mailer);
		await disturb(db, connectionId, daysAfter(NOW, 3));
		await tickAt(db, daysAfter(NOW, 3), mailer);
		counts.push(mailer.sent.length);
		expect(counts).toStrictEqual([0, 1, 1, 2]);
	});

	it('names the connection, the date and the code of a disturbance', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await disturb(db, connectionId, NOW);
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		expect(mailer.sent[0]?.subject).toBe('Die Anbindung Microsoft 365 ist gestört');
		expect(textOf(mailer.sent[0])).toContain('seit 25. November 2026');
		expect(textOf(mailer.sent[0])).toContain('graph.unauthorized');
		const entries = await auditEntries(db, 'sending.disturbance_warned');
		expect(entries.map((entry) => entry.details)).toStrictEqual([
			{ code: 'graph.unauthorized', failed: 0, sent: 1 },
		]);
	});
});

describe('the digest of the sending warnings', () => {
	it('sends nothing without failed or uncertain entries', async () => {
		const { db, mailer } = await setUpDigest();
		await tickAt(db, NOW, mailer);
		expect(mailer.sent).toStrictEqual([]);
	});

	it('counts per sender, names no recipient and logs numbers only', async () => {
		const { db, mailer, resendSenderId, senderId } = await setUpDigest();
		await failEntries(db, senderId, [
			{ claimedAt: new Date('2026-11-25T08:00:00Z'), status: 'failed' },
			{ claimedAt: new Date('2026-11-25T08:05:00Z'), status: 'failed' },
			{ claimedAt: new Date('2026-11-25T08:10:00Z'), status: 'uncertain' },
		]);
		await failEntries(db, resendSenderId, [
			{ claimedAt: new Date('2026-11-25T08:20:00Z'), status: 'uncertain' },
		]);
		await tickAt(db, NOW, mailer);
		const [digest] = mailer.sent;
		expect(digest?.subject).toBe('Fehlgeschlagene und unsichere Mails im Postausgang');
		expect(textOf(digest)).toContain('verein@example.org: 2 fehlgeschlagen, 1 unsicher');
		expect(textOf(digest)).toContain('news@example.org: 0 fehlgeschlagen, 1 unsicher');
		expect(textOf(digest)).not.toContain('member@example.org');
		const entries = await auditEntries(db, 'sending.digest_sent');
		expect(entries.map((entry) => entry.details)).toStrictEqual([
			{ failed: 0, failedEntries: 2, senders: 2, sent: 1, uncertainEntries: 2 },
		]);
	});

	it('sends at most one digest per club day, with the entries since the last one', async () => {
		const { db, mailer, resendSenderId, senderId } = await setUpDigest();
		await failEntries(db, senderId, [
			{ claimedAt: new Date('2026-11-25T08:00:00Z'), status: 'failed' },
		]);
		const counts = await sentAfterEach(db, mailer, ['2026-11-25T10:00:00Z']);
		// New entries the same club day wait for tomorrow.
		await failEntries(db, resendSenderId, [
			{ claimedAt: new Date('2026-11-25T11:00:00Z'), status: 'failed' },
		]);
		counts.push(
			...(await sentAfterEach(db, mailer, [
				'2026-11-25T12:00:00Z',
				'2026-11-26T09:00:00Z',
				'2026-11-27T09:00:00Z',
			])),
		);
		expect(counts).toStrictEqual([1, 1, 2, 2]);
		expect(textOf(mailer.sent[1])).toContain('news@example.org: 1 fehlgeschlagen, 0 unsicher');
		expect(textOf(mailer.sent[1])).not.toContain('verein@example.org');
	});
});

describe('the claim of the sending warnings', () => {
	it('takes the marker back when the audit entry fails, so the next tick tries again', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await expireOn(db, connectionId, '2026-12-20');
		const report = await runTick({
			db,
			env: testEnv(),
			now: () => NOW,
			steps: [createSendingWarningsStep(() => breakingMailer(db))],
			storage: null,
		});
		expect(report).toMatchObject({ steps: [{ name: 'sending-warnings', outcome: 'done' }] });
		const markers = await db
			.select({ value: systemState.value })
			.from(systemState)
			.where(eq(systemState.key, 'sending_secret_warned'));
		expect(markers.map((row) => row.value)).not.toContainEqual({ [connectionId]: 30 });

		await db.execute(sql`alter table audit_log_gone rename to audit_log`);
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		expect(mailer.sent).toHaveLength(1);
	});

	it('takes the digest back when the audit entry fails', async () => {
		const db = await createTestDb();
		const { senderId } = await setUpGraph(db);
		await failEntries(db, senderId, [
			{ claimedAt: new Date('2026-11-25T08:00:00Z'), status: 'failed' },
		]);
		await runTick({
			db,
			env: testEnv(),
			now: () => NOW,
			steps: [createSendingWarningsStep(() => breakingMailer(db))],
			storage: null,
		});
		await db.execute(sql`alter table audit_log_gone rename to audit_log`);
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		expect(mailer.sent).toHaveLength(1);
	});
});

describe('a warning nobody received', () => {
	it('is tried again after an hour, not at every tick', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await expireOn(db, connectionId, '2026-12-20');
		const delivered = new CapturingMailer();
		await tickWith(db, '2026-11-25T10:00:00Z', refusing(null, delivered));
		const counts: number[] = [];
		for (const at of ['2026-11-25T10:10:00Z', '2026-11-25T11:30:00Z', '2026-11-25T11:40:00Z']) {
			// oxlint-disable-next-line no-await-in-loop -- the ticks follow one another
			await tickWith(db, at, delivered);
			counts.push(delivered.sent.length);
		}
		expect(counts).toStrictEqual([0, 1, 1]);
	});

	it('writes no log entry while it reached nobody', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await disturb(db, connectionId, NOW);
		await tickWith(db, '2026-11-25T10:00:00Z', refusing(null, new CapturingMailer()));
		await expect(auditEntries(db, 'sending.disturbance_warned')).resolves.toStrictEqual([]);
	});

	it('keeps the digest entries for the next try', async () => {
		const db = await createTestDb();
		const { senderId } = await setUpGraph(db);
		await failEntries(db, senderId, [
			{ claimedAt: new Date('2026-11-25T08:00:00Z'), status: 'failed' },
		]);
		const delivered = new CapturingMailer();
		await tickWith(db, '2026-11-25T10:00:00Z', refusing(null, delivered));
		await tickWith(db, '2026-11-25T12:00:00Z', delivered);
		expect(delivered.sent).toHaveLength(1);
	});

	it('stays claimed when only one of two admins missed it', async () => {
		const db = await createTestDb();
		const { connectionId } = await setUpGraph(db);
		await insertUser(db, {
			email: 'second-admin@example.org',
			isAdmin: true,
			name: 'Second Admin',
			status: 'active',
		});
		await expireOn(db, connectionId, '2026-12-20');
		const delivered = new CapturingMailer();
		await tickWith(db, '2026-11-25T10:00:00Z', refusing('second-admin@example.org', delivered));
		await tickWith(db, '2026-11-25T14:00:00Z', delivered);
		expect(delivered.sent.map((mail) => mail.to)).toStrictEqual(['admin@example.org']);
	});
});

describe('the digest and the sweep', () => {
	it('reports an entry the sweep turned uncertain after an earlier digest', async () => {
		const db = await createTestDb();
		const { senderId } = await setUpGraph(db);
		await failEntries(db, senderId, [
			{ claimedAt: new Date('2026-11-25T08:00:00Z'), status: 'failed' },
		]);
		await db.insert(outboxEntries).values({
			claimedAt: new Date('2026-11-25T08:30:00Z'),
			priority: 'group',
			senderId,
			source: 'wave',
			sourceId: WAVE_ID,
			status: 'sending',
		});
		const mailer = new CapturingMailer();
		await tickAt(db, NOW, mailer);
		await db
			.update(outboxEntries)
			.set({ lastErrorCode: 'outbox.interrupted', status: 'uncertain' })
			.where(eq(outboxEntries.status, 'sending'));
		await tickAt(db, new Date('2026-11-26T09:00:00Z'), mailer);
		expect(textOf(mailer.sent[1])).toContain('verein@example.org: 0 fehlgeschlagen, 1 unsicher');
	});
});
