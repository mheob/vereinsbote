/*
 * Opens the transport of a sender: decrypts the credentials of its connection and builds the
 * adapter for Graph or Resend. The credentials live only inside the transport object (one tick
 * run or one request) and never leave this module. Also the self test of a sender (Design 6.1):
 * token, test mail to the admin and, for Graph, the restriction test.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { escapeHtml } from '@/mail/escape';
import { writeAudit } from '@/server/audit/audit';
import { normalizeEmail } from '@/server/auth/email';
import { decryptSecret, deriveSecretsKey, secretAad } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { mailConnections, user } from '@/server/db/schema';
import type { Env } from '@/server/env';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { SenderInvalidError, SenderNotFoundError } from './errors';
import { checkMailboxRestriction, createGraphTransport, graphEndpoints } from './graph';
import type { GraphDeps, GraphSettings, RestrictionResult } from './graph';
import { DEFAULT_GRAPH_PER_MINUTE, DEFAULT_RESEND_PER_MINUTE } from './limits';
import { createResendTransport, resendEndpoint } from './resend';
import { isMailAddress, loadSender } from './senders';
import type { SenderSummary } from './senders';
import { newMessageId } from './transport';
import type { Transport } from './transport';

/** What the outbox counts a send against: a Graph sender alone, a Resend connection as a whole. */
type QuotaScope = `connection:${string}` | `sender:${string}`;

interface SenderTransport {
	readonly transport: Transport;
	readonly sender: SenderSummary;
	readonly scope: QuotaScope;
	/** The effective limit: the sender's (Graph) or the connection's (Resend). */
	readonly perMinute: number;
	readonly dailyLimit: number | null;
	readonly connectionId: string;
}

interface SelfTestResult {
	/** Resend has no token to fetch, so its token counts as `ok`; the test mail decides. */
	readonly token: 'failed' | 'ok';
	readonly testMail: 'failed' | 'sent';
	/** Graph only, and only when the token was fetched. */
	readonly restriction: RestrictionResult | null;
}

type OpenDeps = Readonly<{ fetch: typeof fetch; now: () => Date }>;

/** What opening a transport needs besides the database and the sender. */
type OpenContext = OpenDeps & Readonly<{ env: Env }>;

/** A transport with what the self test needs besides it. */
interface Opened {
	readonly result: SenderTransport;
	/** The Graph credentials, or null for Resend. */
	readonly graph: GraphSettings | null;
	readonly graphDeps: GraphDeps;
}

/**
 * Opens the transport of a loaded sender.
 *
 * @param db The database.
 * @param sender The sender.
 * @param context The environment (the app secret, the dev provider), `fetch` and the clock.
 * @returns The transport with its limits, and what the self test needs.
 * @throws {SenderNotFoundError} When the connection of the sender is gone.
 * @throws {SecretDecryptError} When a secret does not decrypt (another app secret, a moved row).
 */
async function openLoaded(
	db: Db,
	sender: Readonly<SenderSummary>,
	context: OpenContext,
): Promise<Opened> {
	const { env } = context;
	const [row] = await db
		.select()
		.from(mailConnections)
		.where(eq(mailConnections.id, sender.connectionId));
	if (row === undefined) throw new SenderNotFoundError();
	const secret = await decryptSecret(
		row.secretCiphertext,
		await deriveSecretsKey(env.appSecret),
		secretAad('mail_connections', row.id, 'secret_ciphertext'),
	);
	const graphDeps: GraphDeps = {
		endpoints: graphEndpoints(env),
		fetch: context.fetch,
		now: context.now,
	};
	if (row.kind === 'graph') {
		const settings: GraphSettings = {
			clientId: row.clientId ?? '',
			clientSecret: secret,
			tenantId: row.tenantId ?? '',
		};
		return {
			graph: settings,
			graphDeps,
			result: {
				connectionId: row.id,
				dailyLimit: sender.dailyLimit,
				perMinute: sender.perMinute ?? DEFAULT_GRAPH_PER_MINUTE,
				scope: `sender:${sender.id}`,
				sender,
				transport: createGraphTransport(settings, sender.email, graphDeps),
			},
		};
	}
	return {
		graph: null,
		graphDeps,
		result: {
			connectionId: row.id,
			dailyLimit: row.dailyLimit,
			perMinute: row.perMinute ?? DEFAULT_RESEND_PER_MINUTE,
			scope: `connection:${row.id}`,
			sender,
			transport: createResendTransport(secret, {
				endpoint: resendEndpoint(env),
				fetch: context.fetch,
				now: context.now,
			}),
		},
	};
}

/**
 * Opens the transport of a sender. Graph senders are limited alone, Resend senders share the
 * limits and the count of their connection.
 *
 * @param db The database.
 * @param env The environment.
 * @param senderId The sender.
 * @param deps `fetch` and the clock.
 * @returns The transport with its scope and limits.
 * @throws {SenderNotFoundError} When no sender has the id.
 * @throws {SecretDecryptError} When a secret does not decrypt.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function openSenderTransport(
	db: Db,
	env: Env,
	senderId: string,
	deps: OpenDeps,
): Promise<SenderTransport> {
	const sender = await loadSender(db, senderId);
	if (sender === null) throw new SenderNotFoundError();
	const { result } = await openLoaded(db, sender, { ...deps, env });
	return result;
}

/** Who a self test mails and which mailbox it tries to read. */
interface SelfTestTarget {
	readonly sender: SenderSummary;
	readonly admin: Readonly<{ email: string; locale: Locale }>;
	readonly probe: string;
}

/**
 * Loads what a self test needs and checks the probe mailbox.
 *
 * @param db The database.
 * @param actor The admin.
 * @param senderId The sender.
 * @param probeMailbox The mailbox for the restriction test, or null for the admin's own address.
 * @returns The sender, the admin's address and language, and the normalized probe mailbox.
 * @throws {SenderNotFoundError} When the sender or the admin does not exist.
 * @throws {SenderInvalidError} When the probe mailbox is no address.
 */
// oxlint-disable-next-line max-params -- the database, the admin, the sender and the probe
async function selfTestTarget(
	db: Db,
	actor: Principal,
	senderId: string,
	probeMailbox: string | null,
): Promise<SelfTestTarget> {
	const sender = await loadSender(db, senderId);
	const [admin] = await db
		.select({ email: user.email, locale: user.locale })
		.from(user)
		.where(eq(user.id, actor.userId));
	if (sender === null || admin === undefined) throw new SenderNotFoundError();
	const typed = probeMailbox === null || probeMailbox.trim() === '' ? admin.email : probeMailbox;
	const probe = normalizeEmail(typed);
	if (!isMailAddress(probe)) throw new SenderInvalidError('probeMailbox');
	return { admin, probe, sender };
}

/**
 * Sends the test mail from the sender to the admin, in the admin's language.
 *
 * @param opened The opened transport.
 * @param target The sender and the admin.
 * @returns Whether the provider accepted the mail.
 */
async function sendTestMail(
	opened: Opened,
	target: Readonly<SelfTestTarget>,
): Promise<SelfTestResult['testMail']> {
	const { admin, sender } = target;
	const text = translate(admin.locale, 'sending.selfTestText', { sender: sender.email });
	const sent = await opened.result.transport.send({
		attachments: [],
		bcc: null,
		from: { address: sender.email, name: sender.displayName },
		html: `<p>${escapeHtml(text)}</p>`,
		idempotencyKey: randomUUID(),
		kind: 'regular',
		listUnsubscribe: null,
		messageId: newMessageId(sender.email),
		replyTo: sender.replyTo,
		subject: translate(admin.locale, 'sending.selfTestSubject'),
		text,
		to: admin.email,
	});
	return sent.ok ? 'sent' : 'failed';
}

/**
 * The three steps of the self test: the token, the test mail and, for Graph, the restriction
 * test. Nothing is sent when the token is refused.
 *
 * @param opened The opened transport.
 * @param target The sender, the admin and the probe mailbox.
 * @returns The outcome.
 */
async function performSelfTest(
	opened: Opened,
	target: Readonly<SelfTestTarget>,
): Promise<SelfTestResult> {
	const { graph, graphDeps, result } = opened;
	const probed = result.transport.probe === null ? null : await result.transport.probe();
	if (probed !== null && !probed.ok)
		return { restriction: null, testMail: 'failed', token: 'failed' };
	const testMail = await sendTestMail(opened, target);
	const restriction =
		graph === null ? null : await checkMailboxRestriction(graph, target.probe, graphDeps);
	return { restriction, testMail, token: 'ok' };
}

/**
 * Stores what a self test found on the connection: the restriction result, and the end of a
 * disturbance when the credentials work again (Resend has no token, so its test mail decides).
 *
 * @param db The database.
 * @param opened The opened transport.
 * @param outcome What the test found.
 * @param now The time of the test.
 */
// oxlint-disable-next-line max-params -- the database, the transport, the outcome and the time
async function storeOutcome(
	db: Db,
	opened: Opened,
	outcome: Readonly<SelfTestResult>,
	now: Date,
): Promise<void> {
	const { restriction } = outcome;
	const recovered =
		outcome.token === 'ok' && (opened.graph !== null || outcome.testMail === 'sent');
	if (restriction === null && !recovered) return;
	await db
		.update(mailConnections)
		.set({
			...(restriction === null ? {} : { restriction, restrictionCheckedAt: now }),
			...(recovered ? { disturbedCode: null, disturbedSince: null } : {}),
		})
		.where(eq(mailConnections.id, opened.result.connectionId));
}

/**
 * Runs the self test of a sender and stores what it found on the connection. The activity log
 * gets the outcome only, no address.
 *
 * @param db The database.
 * @param env The environment.
 * @param actor Who tests; an admin. The test mail goes to their address, in their language.
 * @param senderId The sender.
 * @param probeMailbox The mailbox of the tenant for the restriction test (Graph), or null for
 *   the admin's own address.
 * @param deps `fetch` and the clock.
 * @returns The outcome of the three steps.
 * @throws {ForbiddenError} For anybody but an admin.
 * @throws {SenderNotFoundError} When no sender has the id.
 * @throws {SenderInvalidError} When the probe mailbox is no address.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function runSelfTest(
	db: Db,
	env: Env,
	actor: Principal,
	senderId: string,
	probeMailbox: string | null,
	deps: OpenDeps,
): Promise<SelfTestResult> {
	assertAdmin(actor);
	const target = await selfTestTarget(db, actor, senderId, probeMailbox);
	const opened = await openLoaded(db, target.sender, { ...deps, env });
	const outcome = await performSelfTest(opened, target);
	await storeOutcome(db, opened, outcome, deps.now());
	await writeAudit(db, {
		action: 'sender.self_tested',
		actorUserId: actor.userId,
		details: { ...outcome },
		target: `sender:${senderId}`,
	});
	return outcome;
}

export { openSenderTransport, runSelfTest };
export type { QuotaScope, SelfTestResult, SenderTransport };
