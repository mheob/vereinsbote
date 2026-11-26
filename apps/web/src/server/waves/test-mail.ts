/*
 * The test mail of the send flow (Design 10.4): the occasion's mail with the values of the contact
 * the preview shows, to the signed-in user's own address, never to a contact
 * (`test-mail-content.ts`). It goes out at once through the occasion's sender, not through the
 * outbox, within the request, and counts against the sender's daily limit like every mail
 * (Design 8.3). A Graph sender refuses it above the size of a request (Design 6.4); a user sends at
 * most `TEST_MAILS_PER_HOUR` an hour (`test-mail-rate.ts`).
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
import { claimTestMail, giveBackTestMail, hasTestMailLeft } from './test-mail-rate';
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
 * @param claimId The activity log entry of the claim.
 * @returns The provider's answer and the scope.
 * @throws {TestMailNotSentError} When the secret of the connection does not decrypt.
 */
async function handOverClaimed(
	deps: TestMailDeps,
	built: BuiltTestMail,
	claimId: number,
): Promise<HandedOver> {
	try {
		return await handOver(deps, built);
	} catch (error) {
		await giveBackTestMail(deps.db, claimId);
		throw error instanceof SecretDecryptError ? new TestMailNotSentError(false) : error;
	}
}

/**
 * Records a mail the provider did not take: an unclear answer counts it and keeps its claim (it
 * may still arrive); a refusal gives the claim back, and a refused access disturbs the connection,
 * as in the outbox (Design 8.6).
 *
 * @param deps The database and the clock.
 * @param built The mail and its sender.
 * @param refused The claim, the scope and the provider's answer.
 * @param refused.claimId The activity log entry of the claim.
 * @param refused.scope The scope the mail counts against.
 * @param refused.sent The answer.
 */
async function recordRefusal(
	deps: TestMailDeps,
	built: BuiltTestMail,
	refused: Readonly<{
		claimId: number;
		scope: QuotaScope;
		sent: Readonly<Extract<SendResult, { ok: false }>>;
	}>,
): Promise<void> {
	const { db } = deps;
	const { claimId, scope, sent } = refused;
	if (sent.failure === 'uncertain') {
		await countSent(db, scope, deps.now());
		return;
	}
	await giveBackTestMail(db, claimId);
	if (sent.failure === 'unauthorized') {
		await disturbConnection(db, built.sender.connectionId, sent.code, deps.now());
	}
}

/**
 * Sends a claimed test mail; a mail the provider took counts against the daily limit.
 *
 * @param deps The database, the environment, `fetch` and the clock.
 * @param built The mail and its sender.
 * @param claimId The activity log entry of the claim.
 * @throws {TestMailNotSentError} When the provider did not take the mail, or its answer is unclear.
 */
async function deliver(deps: TestMailDeps, built: BuiltTestMail, claimId: number): Promise<void> {
	const { scope, sent } = await handOverClaimed(deps, built, claimId);
	if (sent.ok) {
		await countSent(deps.db, scope, deps.now());
		return;
	}
	await recordRefusal(deps, built, { claimId, scope, sent });
	throw new TestMailNotSentError(sent.failure === 'uncertain');
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
 * Claims one of the user's test mails of the hour for a built mail.
 *
 * @param deps The database and the clock.
 * @param actor Who tests.
 * @param occasionId The occasion.
 * @param built The mail.
 * @returns The activity log entry of the claim, or null when the hour is used up.
 */
// oxlint-disable-next-line max-params -- the dependencies, the user, the occasion and the mail
async function claimFor(
	deps: TestMailDeps,
	actor: Principal,
	occasionId: string,
	built: BuiltTestMail,
): Promise<number | null> {
	return claimTestMail(deps.db, {
		attachments: built.mail.attachments.length,
		now: deps.now(),
		occasionId,
		userId: actor.userId,
	});
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
	const claimId = await claimFor(deps, actor, occasion.id, built);
	if (claimId === null) return { refused: 'rate' };
	await deliver(deps, built, claimId);
	return { ok: true };
}

export { sendTestMail };
export { TEST_MAILS_PER_HOUR } from './test-mail-limit';
export type { TestMailRefusal } from './test-mail-content';
export type { TestMailDeps, TestMailInput, TestMailResult };
