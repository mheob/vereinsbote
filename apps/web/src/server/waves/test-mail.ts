/*
 * The test mail of the send flow (Design 10.4): the occasion's mail with the values of the contact
 * the preview shows, to the signed-in user's own address, never to a contact
 * (`test-mail-content.ts`). It goes out at once through the occasion's sender, not through the
 * outbox, within the request, and counts against the sender's daily limit like every mail
 * (Design 8.3). A Graph sender refuses it above the size of a request (Design 6.4); a user sends at
 * most `TEST_MAILS_PER_HOUR` an hour (`test-mail-rate.ts`, claims of their own, ruling R20). The
 * activity log gets `wave.test_sent` only for a mail the provider took or whose answer was unclear.
 */
import { SecretDecryptError } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import type { Env } from '@/server/env';
import type { Principal } from '@/server/permissions/principal';
import { GRAPH_REQUEST_LIMIT_BYTES, graphRequestBytes } from '@/server/sending/mime';
import { openSenderTransport } from '@/server/sending/open-transport';
import type { QuotaScope } from '@/server/sending/open-transport';
import { disturbConnection } from '@/server/sending/outbox';
import { countSent } from '@/server/sending/quota';
import type { SendResult } from '@/server/sending/transport';
import type { ObjectStorage } from '@/server/storage/storage';

import { TestMailNotSentError } from './errors';
import { buildTestMail } from './test-mail-content';
import type { BuiltTestMail, RefusedTestMail } from './test-mail-content';
import { claimTestMail, giveBackTestMail, hasTestMailLeft, logTestMail } from './test-mail-rate';
import { sendableOccasion } from './waves';

/** What the test mail needs besides the user and the input. */
type TestMailDeps = Readonly<{
	db: Db;
	env: Env;
	storage: ObjectStorage | null;
	fetch: typeof fetch;
	now: () => Date;
}>;

/** The occasion, the contact whose values fill the mail, and the files of the flow. */
type TestMailInput = Readonly<{
	occasionId: string;
	contactId: string;
	attachmentIds: readonly string[];
}>;

type TestMailResult = { ok: true } | RefusedTestMail;

/** The provider's answer to a test mail and the scope it counts against. */
interface HandedOver {
	readonly sent: SendResult;
	readonly scope: QuotaScope;
}

/** A claimed test mail: the claim, who tests and the occasion. */
interface Claimed {
	readonly id: string;
	readonly userId: string;
	readonly occasionId: string;
}

/** The code of a connection whose secret does not decrypt, as the outbox records it. */
const CREDENTIALS_CODE = 'outbox.credentials';

/**
 * Hands the mail to the sender's provider. A secret that does not decrypt disturbs the connection,
 * like in the outbox; the error goes on.
 *
 * @param deps The database, the environment, `fetch` and the clock.
 * @param built The mail and its sender.
 * @returns The provider's answer and the scope the mail counts against.
 */
async function handOver(deps: TestMailDeps, built: BuiltTestMail): Promise<HandedOver> {
	const { db, env } = deps;
	try {
		const opened = await openSenderTransport(db, env, built.sender.id, deps);
		return { scope: opened.scope, sent: await opened.transport.send(built.mail) };
	} catch (error) {
		if (error instanceof SecretDecryptError) {
			await disturbConnection(db, built.sender.connectionId, CREDENTIALS_CODE, deps.now());
		}
		throw error;
	}
}

/**
 * Hands a claimed mail over; when that throws, the claim goes back.
 *
 * @param deps The database, the environment, `fetch` and the clock.
 * @param built The mail and its sender.
 * @param claimId The claim.
 * @returns The provider's answer and the scope.
 * @throws {TestMailNotSentError} When the secret of the connection does not decrypt.
 */
async function handOverClaimed(
	deps: TestMailDeps,
	built: BuiltTestMail,
	claimId: string,
): Promise<HandedOver> {
	try {
		return await handOver(deps, built);
	} catch (error) {
		await giveBackTestMail(deps.db, claimId);
		throw error instanceof SecretDecryptError ? new TestMailNotSentError(false) : error;
	}
}

/**
 * Records a mail that went out, or may have (an unclear answer): it counts against the daily limit,
 * keeps its claim and goes into the activity log.
 *
 * @param deps The database and the clock.
 * @param built The mail.
 * @param claimed The claim, the user and the occasion.
 * @param handed The scope and whether the answer was unclear.
 * @param handed.scope The scope the mail counts against.
 * @param handed.uncertain Whether the answer was unclear.
 */
// oxlint-disable-next-line max-params -- the dependencies, the mail, the claim and the outcome
async function recordSent(
	deps: TestMailDeps,
	built: BuiltTestMail,
	claimed: Claimed,
	handed: Readonly<{ scope: QuotaScope; uncertain: boolean }>,
): Promise<void> {
	const now = deps.now();
	await countSent(deps.db, handed.scope, now);
	await logTestMail(deps.db, {
		attachments: built.mail.attachments.length,
		now,
		occasionId: claimed.occasionId,
		uncertain: handed.uncertain,
		userId: claimed.userId,
	});
}

/**
 * Records a mail the provider refused: the claim goes back, nothing is logged, and a refused
 * access disturbs the connection, as in the outbox (Design 8.6).
 *
 * @param deps The database and the clock.
 * @param built The mail and its sender.
 * @param claimId The claim.
 * @param sent The answer.
 */
// oxlint-disable-next-line max-params -- the dependencies, the mail, the claim and the answer
async function recordRefusal(
	deps: TestMailDeps,
	built: BuiltTestMail,
	claimId: string,
	sent: Readonly<Extract<SendResult, { ok: false }>>,
): Promise<void> {
	const { db } = deps;
	await giveBackTestMail(db, claimId);
	if (sent.failure === 'unauthorized') {
		await disturbConnection(db, built.sender.connectionId, sent.code, deps.now());
	}
}

/**
 * Sends a claimed test mail. A mail the provider took counts against the daily limit and is logged;
 * an unclear answer too (it may still arrive), a refusal gives the claim back.
 *
 * @param deps The database, the environment, `fetch` and the clock.
 * @param built The mail and its sender.
 * @param claimed The claim, the user and the occasion.
 * @throws {TestMailNotSentError} When the provider did not take the mail, or its answer is unclear.
 */
async function deliver(deps: TestMailDeps, built: BuiltTestMail, claimed: Claimed): Promise<void> {
	const { scope, sent } = await handOverClaimed(deps, built, claimed.id);
	if (sent.ok) {
		await recordSent(deps, built, claimed, { scope, uncertain: false });
		return;
	}
	const uncertain = sent.failure === 'uncertain';
	await (uncertain
		? recordSent(deps, built, claimed, { scope, uncertain })
		: recordRefusal(deps, built, claimed.id, sent));
	throw new TestMailNotSentError(uncertain);
}

/**
 * Whether a mail exceeds a request of its Graph sender (Design 6.4).
 *
 * @param built The mail and its sender.
 * @param now The `Date` header's time.
 * @returns True for a Graph sender whose request would be too large.
 */
function tooLargeForGraph(built: BuiltTestMail, now: Date): boolean {
	return (
		built.sender.connectionKind === 'graph' &&
		graphRequestBytes(built.mail, now) > GRAPH_REQUEST_LIMIT_BYTES
	);
}

/**
 * Claims one of the user's test mails of the hour.
 *
 * @param deps The database and the clock.
 * @param actor Who tests.
 * @param occasionId The occasion.
 * @returns The claim, or null when the hour is used up.
 */
async function claimFor(
	deps: TestMailDeps,
	actor: Principal,
	occasionId: string,
): Promise<Claimed | null> {
	const { userId } = actor;
	const id = await claimTestMail(deps.db, { now: deps.now(), occasionId, userId });
	return id === null ? null : { id, occasionId, userId };
}

/**
 * Sends the test mail of a send flow to the signed-in user.
 *
 * @param deps The database, the environment, the storage of the files, `fetch` and the clock.
 * @param actor Who tests; needs `send` in the occasion's area.
 * @param input The occasion, the contact the preview shows and the files of the flow.
 * @returns Done, or why it was refused; a refusal sends nothing.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `send` in the occasion's area.
 * @throws {OccasionInvalidError} When the occasion is archived (`archived`).
 * @throws {ContactNotFoundError} When the contact is gone.
 * @throws {WaveAttachmentsGoneError} When a file is no free attachment of the occasion any more.
 * @throws {TestMailNotSentError} When the provider did not take the mail.
 */
async function sendTestMail(
	deps: TestMailDeps,
	actor: Principal,
	input: TestMailInput,
): Promise<TestMailResult> {
	const { db, env, storage } = deps;
	const occasion = await sendableOccasion(db, actor, input.occasionId);
	if (!(await hasTestMailLeft(db, actor.userId, deps.now()))) return { refused: 'rate' };
	const built = await buildTestMail(
		{ appOrigin: env.appUrl.origin, db, storage },
		actor,
		occasion,
		input,
	);
	if ('refused' in built) return built;
	if (tooLargeForGraph(built, deps.now())) return { refused: 'graphTooLarge' };
	const claimed = await claimFor(deps, actor, occasion.id);
	if (claimed === null) return { refused: 'rate' };
	await deliver(deps, built, claimed);
	return { ok: true };
}

export { sendTestMail };
export { TEST_MAILS_PER_HOUR } from './test-mail-limit';
export type { TestMailRefusal } from './test-mail-content';
export type { TestMailDeps, TestMailInput, TestMailResult };
