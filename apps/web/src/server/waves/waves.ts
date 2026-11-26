/*
 * The waves of an occasion (Design 10.5, 11.1): the summary a user confirms, and the wave the
 * confirmation makes in one transaction: the template compiled at that moment, one outbox entry
 * per mail with its contacts, the attachments and the activity log. A problem of the template or
 * the selection refuses the wave before any entry exists. A second confirmation of the same flow
 * (`requestId`, plan decision 18) gets the wave of the first.
 */
import { and, count, eq, inArray, isNull, lte } from 'drizzle-orm';

import { UNSUBSCRIBE_URL_KEY } from '@/mail/placeholders/registry';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import { compileMail } from '@/mail/render/compile';
import type { CompiledMail } from '@/mail/render/compile';
import { fillMail } from '@/mail/render/fill';
import { writeAudit } from '@/server/audit/audit';
import { getBrand } from '@/server/brand/brand';
import type { Db } from '@/server/db/client';
import {
	attachments,
	mailConnections,
	occasions,
	outboxEntries,
	senders,
	waveContacts,
	waves,
} from '@/server/db/schema';
import {
	OccasionChangedError,
	OccasionInvalidError,
	OccasionNotFoundError,
} from '@/server/occasions/errors';
import { getOccasion } from '@/server/occasions/occasions';
import type { OccasionRecord } from '@/server/occasions/occasions';
import { assertArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { GRAPH_REQUEST_LIMIT_BYTES, graphRequestBytes } from '@/server/sending/mime';
import { estimateDays, inScope, quotaToday } from '@/server/sending/quota';
import { templateMailSource } from '@/server/templates/sending-values';
import { getTemplate } from '@/server/templates/templates';
import { standInUnsubscribeLink } from '@/server/unsubscribe/url';

import { WaveAttachmentsGoneError } from './errors';
import { planMails } from './merge';
import type { PlannedMail } from './merge';
import { resolveRecipients } from './recipients';
import type { ExclusionReason, RecipientSelection } from './recipients';

interface WaveSummaryInput {
	occasionId: string;
	selection: RecipientSelection;
	attachmentIds: readonly string[];
}

/** What a template or a selection lacks: no wave can be made with it. */
type WaveProblem = 'compile' | 'missingBrand' | 'noRecipients' | 'unsubscribe';

/** The dialog before the confirmation (Design 10.5). */
interface WaveSummary {
	mails: number;
	/** Addresses of a circular that get one mail for several contacts. */
	merged: number;
	excluded: Record<ExclusionReason, number>;
	attachmentsBytes: number;
	/** Club days until the last mail goes, today the first; infinite when the reserve leaves none. */
	estimatedDays: number;
	/** The sender is a Graph sender and a mail with all attachments exceeds its request (Design 6.4). */
	graphTooLarge: boolean;
	problem: WaveProblem | null;
}

/** Why a confirmation made no wave. */
type WaveRefusal = WaveProblem | 'graphTooLarge' | 'scheduleOutOfRange';

interface WaveConfirmation extends WaveSummaryInput {
	/** The key of the flow, made by the browser when it opened (plan decision 18). */
	requestId: string;
	/** When the mails may go; null: at once. */
	notBefore: Date | null;
}

type ConfirmedWave = { waveId: string; mails: number } | { refused: WaveRefusal };

/** The sender of an occasion as the summary needs it. */
interface WaveSender {
	readonly id: string;
	readonly email: string;
	readonly displayName: string;
	readonly replyTo: string | null;
	readonly provider: 'graph' | 'resend';
	/** What the daily limit counts: a Graph sender alone, a Resend connection as a whole. */
	readonly scope: `connection:${string}` | `sender:${string}`;
}

/** A file of the flow as the wave needs it. */
interface WaveAttachment {
	readonly id: string;
	readonly name: string;
	readonly type: typeof attachments.$inferSelect.type;
	readonly size: number;
}

/** The template of a wave, compiled at the confirmation. */
interface CompiledTemplate {
	readonly templateId: string;
	readonly templateVersion: number;
	readonly salutationTexts: SalutationTexts;
	/** Null when it does not compile; `problem` says why. */
	readonly mail: CompiledMail | null;
	readonly problem: Exclude<WaveProblem, 'noRecipients'> | null;
}

/** Everything a summary and a confirmation read before a wave is made. */
interface WavePlan {
	readonly occasion: OccasionRecord;
	readonly template: CompiledTemplate;
	readonly mails: readonly PlannedMail[];
	readonly excluded: Readonly<Record<ExclusionReason, number>>;
	readonly attachments: readonly WaveAttachment[];
	readonly sender: WaveSender;
	readonly problem: WaveProblem | null;
}

/** The length of every value in the probe mail: a generous bound for names and texts. */
const STAND_IN_VALUE_LENGTH = 100;
/** The length of the random part of a Message-ID (`newMessageId`). */
const MESSAGE_ID_LENGTH = 22;
/** Rows per insert: well below the 65,535 parameters of a PostgreSQL statement. */
const INSERT_CHUNK = 1000;
/** Subject, HTML and text of a mail that does not compile: the probe carries its files only. */
const NO_CONTENT = { html: '', subject: '', text: '' } as const;

/**
 * Loads an occasion the user may send for.
 *
 * @param db The database.
 * @param actor Who sends; needs `send` in the occasion's area.
 * @param occasionId The occasion.
 * @returns The occasion.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `send` in the area.
 * @throws {OccasionInvalidError} When the occasion is archived (`archived`).
 */
async function sendableOccasion(
	db: Db,
	actor: Principal,
	occasionId: string,
): Promise<OccasionRecord> {
	const occasion = await getOccasion(db, actor, occasionId);
	assertArea(actor, occasion.areaId, 'send');
	if (occasion.archivedAt !== null) throw new OccasionInvalidError('archived');
	return occasion;
}

/**
 * Compiles the occasion's template as a wave sends it: in German, with or without the unsubscribe
 * link as the occasion says. Runs queries at once: never inside a transaction.
 *
 * @param db The database.
 * @param actor Who sends; reads the template.
 * @param occasion The occasion.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @returns The compiled template, or why it does not compile.
 */
// oxlint-disable-next-line max-params -- the database, the actor, the occasion and the origin
async function compileFor(
	db: Db,
	actor: Principal,
	occasion: OccasionRecord,
	appOrigin: string,
): Promise<CompiledTemplate> {
	const template = await getTemplate(db, actor, occasion.templateId);
	const source = await templateMailSource(db, template, appOrigin);
	const { brand } = await getBrand(db);
	const compiled = await compileMail(source, brand, appOrigin, 'de', {
		unsubscribe: occasion.unsubscribe,
	});
	const kept = {
		salutationTexts: template.salutationTexts,
		templateId: template.id,
		templateVersion: template.version,
	};
	if (compiled.ok) return { ...kept, mail: compiled.mail, problem: null };
	if ('missingBrand' in compiled) return { ...kept, mail: null, problem: 'missingBrand' };
	const problem = compiled.invalid === 'unsubscribe' ? 'unsubscribe' : 'compile';
	return { ...kept, mail: null, problem };
}

/**
 * The files of the flow: each must be an attachment of the occasion that no wave holds.
 *
 * @param db The database or transaction.
 * @param occasionId The occasion.
 * @param ids The attachments the flow chose.
 * @param lock Whether to lock the rows until the transaction ends.
 * @returns The attachments, in the order of `ids`.
 * @throws {WaveAttachmentsGoneError} When one of them is not such an attachment.
 */
// oxlint-disable-next-line max-params -- the database, the occasion, the ids and the lock
async function freeAttachments(
	db: Db,
	occasionId: string,
	ids: readonly string[],
	lock: boolean,
): Promise<WaveAttachment[]> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return [];
	const query = db
		.select({
			id: attachments.id,
			name: attachments.name,
			size: attachments.size,
			type: attachments.type,
		})
		.from(attachments)
		.where(
			and(
				inArray(attachments.id, unique),
				eq(attachments.occasionId, occasionId),
				isNull(attachments.waveId),
			),
		);
	const rows = lock ? await query.for('update') : await query;
	const byId = new Map(rows.map((row) => [row.id, row]));
	return unique.map((id) => {
		const row = byId.get(id);
		if (row === undefined) throw new WaveAttachmentsGoneError();
		return row;
	});
}

/**
 * The sender of an occasion with its provider and quota scope.
 *
 * @param db The database.
 * @param senderId The sender; an occasion's sender cannot be deleted.
 * @returns The sender.
 */
async function senderOf(db: Db, senderId: string): Promise<WaveSender> {
	const [row] = await db
		.select({
			connectionId: senders.connectionId,
			displayName: senders.displayName,
			email: senders.email,
			provider: mailConnections.kind,
			replyTo: senders.replyTo,
		})
		.from(senders)
		.innerJoin(mailConnections, eq(mailConnections.id, senders.connectionId))
		.where(eq(senders.id, senderId));
	if (row === undefined) throw new Error('The sender of the occasion does not exist.');
	const { connectionId, provider, ...rest } = row;
	return {
		...rest,
		id: senderId,
		provider,
		scope: provider === 'graph' ? `sender:${senderId}` : `connection:${connectionId}`,
	};
}

/**
 * Reads what a wave needs: the occasion, its compiled template, the recipients and their mails,
 * the attachments and the sender. Never inside a transaction.
 *
 * @param db The database.
 * @param actor Who sends.
 * @param input The occasion, the selection and the attachments.
 * @param appOrigin The origin of the app.
 * @param now The instant.
 * @returns The plan.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `send` in the occasion's area.
 * @throws {OccasionInvalidError} When the occasion is archived.
 * @throws {WaveAttachmentsGoneError} When a chosen file is no free attachment of the occasion.
 */
// oxlint-disable-next-line max-params -- the parameters of `summarizeWave`
async function planWave(
	db: Db,
	actor: Principal,
	input: Readonly<WaveSummaryInput>,
	appOrigin: string,
	now: Date,
): Promise<WavePlan> {
	const occasion = await sendableOccasion(db, actor, input.occasionId);
	const template = await compileFor(db, actor, occasion, appOrigin);
	const recipients = await resolveRecipients(db, actor, occasion, input.selection, now);
	const mails = planMails(occasion.kind, recipients.mailable);
	return {
		attachments: await freeAttachments(db, occasion.id, input.attachmentIds, false),
		excluded: recipients.excluded,
		mails,
		occasion,
		problem: template.problem ?? (mails.length === 0 ? 'noRecipients' : null),
		sender: await senderOf(db, occasion.senderId),
		template,
	};
}

/**
 * The unsubscribe link the probe carries: a stand-in token as long as the longest token a mail of
 * the plan gets (every merged contact of an address is in it), so that the probe is never smaller
 * than a real mail.
 *
 * @param plan The plan.
 * @param appOrigin The origin of the app.
 * @returns The link, or null when the occasion sends none.
 */
function standInLink(plan: WavePlan, appOrigin: string): string | null {
	const { occasion } = plan;
	if (!occasion.unsubscribe) return null;
	const target = { areaId: occasion.areaId, occasionId: occasion.id };
	return standInUnsubscribeLink(appOrigin, target, plan.mails);
}

/**
 * The compiled mail filled with stand-ins: every value `STAND_IN_VALUE_LENGTH` characters long,
 * the unsubscribe link the probe's header carries too.
 *
 * @param mail The compiled mail.
 * @param link The stand-in unsubscribe link, or null.
 * @returns Subject, HTML and text, or none when the stand-ins do not fill it.
 */
function filledWithStandIns(
	mail: CompiledMail,
	link: string | null,
): Readonly<{ subject: string; html: string; text: string }> {
	const value = 'x'.repeat(STAND_IN_VALUE_LENGTH);
	const values = new Map(
		mail.slots.map(({ key }) => [key, key === UNSUBSCRIBE_URL_KEY ? (link ?? '') : value]),
	);
	const filled = fillMail(mail, values);
	return filled.ok ? filled.mail : NO_CONTENT;
}

/**
 * Whether a mail of the wave with all its attachments exceeds a Graph request (Design 6.4). The
 * probe carries the attachments as zero bytes of their sizes: the request's size depends on the
 * size only.
 *
 * @param plan The plan.
 * @param appOrigin The origin of the app.
 * @param now The `Date` header's time.
 * @returns True for a Graph sender whose request would be too large.
 */
function graphTooLarge(plan: WavePlan, appOrigin: string, now: Date): boolean {
	const { sender, template } = plan;
	if (sender.provider !== 'graph') return false;
	const link = standInLink(plan, appOrigin);
	const content = template.mail === null ? NO_CONTENT : filledWithStandIns(template.mail, link);
	const domain = sender.email.slice(sender.email.lastIndexOf('@') + 1);
	const probe = {
		...content,
		attachments: plan.attachments.map(({ name, size, type }) => ({
			bytes: new Uint8Array(size),
			contentType: type,
			filename: name,
		})),
		bcc: null,
		from: { address: sender.email, name: sender.displayName },
		idempotencyKey: null,
		kind: 'regular' as const,
		listUnsubscribe: link,
		messageId: `<${'x'.repeat(MESSAGE_ID_LENGTH)}@${domain}>`,
		replyTo: sender.replyTo,
		to: sender.email,
	};
	return graphRequestBytes(probe, now) > GRAPH_REQUEST_LIMIT_BYTES;
}

/**
 * The priority of a wave's entries: personal mails go first and keep their reserve.
 *
 * @param kind The kind of the occasion.
 * @returns The priority.
 */
function priorityOf(kind: OccasionRecord['kind']): 'group' | 'personal' {
	return kind === 'personal' ? 'personal' : 'group';
}

/**
 * How many club days the wave takes (Design 10.5): from the daily limit, today's count, the
 * reserve of personal mails (only a circular leaves it free) and the entries of the same priority
 * that are due already and go first.
 *
 * @param db The database.
 * @param plan The plan.
 * @param now The instant.
 * @returns The days; 0 without mails.
 */
async function estimateFor(db: Db, plan: WavePlan, now: Date): Promise<number> {
	if (plan.mails.length === 0) return 0;
	const { scope } = plan.sender;
	const priority = priorityOf(plan.occasion.kind);
	const state = await quotaToday(db, scope, now);
	const [ahead] = await db
		.select({ entries: count() })
		.from(outboxEntries)
		.where(
			and(
				inScope(scope),
				eq(outboxEntries.status, 'planned'),
				eq(outboxEntries.priority, priority),
				lte(outboxEntries.notBefore, now),
			),
		);
	return estimateDays({
		limit: state.limit,
		mails: plan.mails.length + (ahead?.entries ?? 0),
		reservedPerDay: priority === 'group' ? state.reserved : 0,
		usedToday: state.used,
	});
}

/**
 * Summarizes the wave a confirmation would make (Design 10.5).
 *
 * @param db The database.
 * @param actor Who sends; needs `send` in the occasion's area.
 * @param input The occasion, the selection and the attachments.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @param now The instant.
 * @returns The summary, with the problem that would refuse the wave.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `send` in the occasion's area.
 * @throws {OccasionInvalidError} When the occasion is archived (`archived`).
 * @throws {WaveAttachmentsGoneError} When a chosen file is no free attachment of the occasion.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function summarizeWave(
	db: Db,
	actor: Principal,
	input: Readonly<WaveSummaryInput>,
	appOrigin: string,
	now: Date,
): Promise<WaveSummary> {
	const plan = await planWave(db, actor, input, appOrigin, now);
	return {
		attachmentsBytes: plan.attachments.reduce((sum, { size }) => sum + size, 0),
		estimatedDays: await estimateFor(db, plan, now),
		excluded: { ...plan.excluded },
		graphTooLarge: graphTooLarge(plan, appOrigin, now),
		mails: plan.mails.length,
		merged: plan.mails.filter(({ contacts }) => contacts.length > 1).length,
		problem: plan.problem,
	};
}

/**
 * Whether a planned start is allowed: not in the past and at most a year ahead (Design 8.7).
 *
 * @param notBefore The start, or null for at once.
 * @param now The instant.
 * @returns True when allowed.
 */
function inSchedule(notBefore: Date | null, now: Date): boolean {
	if (notBefore === null) return true;
	const latest = new Date(now);
	latest.setUTCFullYear(latest.getUTCFullYear() + 1);
	return notBefore.getTime() >= now.getTime() && notBefore.getTime() <= latest.getTime();
}

/**
 * The wave a flow made already, with its number of mails.
 *
 * @param db The database or transaction.
 * @param requestId The key of the flow.
 * @param occasionId The occasion; a key of another occasion's flow finds nothing.
 * @returns The wave, or null.
 */
async function waveOfRequest(
	db: Db,
	requestId: string,
	occasionId: string,
): Promise<{ waveId: string; mails: number } | null> {
	const [wave] = await db
		.select({ id: waves.id })
		.from(waves)
		.where(and(eq(waves.requestId, requestId), eq(waves.occasionId, occasionId)));
	if (wave === undefined) return null;
	const [entries] = await db
		.select({ mails: count() })
		.from(outboxEntries)
		.where(eq(outboxEntries.waveId, wave.id));
	return { mails: entries?.mails ?? 0, waveId: wave.id };
}

/**
 * Holds the occasion until the transaction ends, so it can be neither removed nor changed while
 * the wave is made, and checks that it is as the plan read it.
 *
 * @param tx The transaction.
 * @param occasion The occasion as the plan read it.
 * @throws {OccasionNotFoundError} When the occasion is gone.
 * @throws {OccasionInvalidError} When it was archived meanwhile (`archived`).
 * @throws {OccasionChangedError} When somebody changed it since the plan read it.
 */
async function holdOccasion(tx: Db, occasion: OccasionRecord): Promise<void> {
	const [row] = await tx
		.select({ archivedAt: occasions.archivedAt, version: occasions.version })
		.from(occasions)
		.where(eq(occasions.id, occasion.id))
		.for('share');
	if (row === undefined) throw new OccasionNotFoundError();
	if (row.archivedAt !== null) throw new OccasionInvalidError('archived');
	if (row.version !== occasion.version) throw new OccasionChangedError();
}

/**
 * Inserts rows in chunks, one statement each.
 *
 * @param rows The rows.
 * @param insert Inserts one chunk.
 */
async function insertChunked<T>(
	rows: readonly T[],
	insert: (chunk: readonly T[]) => Promise<unknown>,
): Promise<void> {
	for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
		// oxlint-disable-next-line no-await-in-loop -- one statement at a time on the transaction
		await insert(rows.slice(start, start + INSERT_CHUNK));
	}
}

/**
 * Inserts the entries of a wave and the contacts of each.
 *
 * @param tx The transaction.
 * @param plan The plan.
 * @param wave The wave, its id and when its mails may go.
 * @param wave.id The wave.
 * @param wave.notBefore When the mails may go.
 */
async function insertEntries(
	tx: Db,
	plan: WavePlan,
	wave: Readonly<{ id: string; notBefore: Date }>,
): Promise<void> {
	const priority = priorityOf(plan.occasion.kind);
	const entries = plan.mails.map((mail) => ({ id: crypto.randomUUID(), mail }));
	await insertChunked(entries, async (chunk) =>
		tx.insert(outboxEntries).values(
			chunk.map(({ id }) => ({
				id,
				notBefore: wave.notBefore,
				priority,
				senderId: plan.sender.id,
				source: 'wave' as const,
				sourceId: wave.id,
				waveId: wave.id,
			})),
		),
	);
	const contacts = entries.flatMap(({ id, mail }) =>
		mail.contacts.map((contact, position) => ({
			contactId: contact.id,
			contactKey: contact.contactKey,
			email: mail.address,
			entryId: id,
			kind: contact.kind,
			position,
		})),
	);
	await insertChunked(contacts, async (chunk) => tx.insert(waveContacts).values([...chunk]));
}

/**
 * Links the chosen files to the wave, after locking them (`for update`). `removeAttachment` and
 * the cleanup delete a file only under the same lock and only while no wave holds it
 * (`deleteFreeAttachment`): this waits for a deletion and then finds the file gone, and a file it
 * linked keeps its object.
 *
 * @param tx The transaction.
 * @param plan The plan.
 * @param waveId The wave.
 * @throws {WaveAttachmentsGoneError} When a file is no free attachment of the occasion any more.
 */
async function linkAttachments(tx: Db, plan: WavePlan, waveId: string): Promise<void> {
	const chosen = plan.attachments.map(({ id }) => id);
	const locked = await freeAttachments(tx, plan.occasion.id, chosen, true);
	if (locked.length === 0) return;
	await tx
		.update(attachments)
		.set({ waveId })
		.where(
			inArray(
				attachments.id,
				locked.map(({ id }) => id),
			),
		);
}

/**
 * Inserts the wave row, unless a confirmation of the same flow made it first: the unique request
 * id makes this one wait for that one to end.
 *
 * @param tx The transaction.
 * @param actor Who confirms.
 * @param plan The plan; its template compiled.
 * @param input The confirmation.
 * @returns The id of the new wave, or null when the flow's wave exists.
 */
// oxlint-disable-next-line max-params -- the transaction, the actor, the plan and the input
async function insertWaveRow(
	tx: Db,
	actor: Principal,
	plan: WavePlan,
	input: Readonly<WaveConfirmation>,
): Promise<string | null> {
	const { occasion, template } = plan;
	if (template.mail === null) throw new Error('A wave needs a compiled template.');
	const [wave] = await tx
		.insert(waves)
		.values({
			areaId: occasion.areaId,
			compiled: template.mail,
			createdByUserId: actor.userId,
			kind: occasion.kind,
			notBefore: input.notBefore,
			occasionId: occasion.id,
			requestId: input.requestId,
			salutationTexts: template.salutationTexts,
			senderId: plan.sender.id,
			templateId: template.templateId,
			templateVersion: template.templateVersion,
			unsubscribe: occasion.unsubscribe,
		})
		.onConflictDoNothing({ target: waves.requestId })
		.returning({ id: waves.id });
	return wave?.id ?? null;
}

/**
 * The wave a confirmation of the same flow made while this one waited.
 *
 * @param tx The transaction.
 * @param requestId The key of the flow.
 * @param occasionId The occasion.
 * @returns The wave and its number of mails.
 * @throws {Error} When the key belongs to the wave of another occasion: a forged confirmation.
 */
async function madeWave(
	tx: Db,
	requestId: string,
	occasionId: string,
): Promise<{ waveId: string; mails: number }> {
	const made = await waveOfRequest(tx, requestId, occasionId);
	if (made === null) throw new Error('The request id belongs to the wave of another occasion.');
	return made;
}

/**
 * Makes the wave of a plan inside a transaction, unless a confirmation of the same flow made it
 * first: then that wave is the answer.
 *
 * @param tx The transaction.
 * @param actor Who confirms.
 * @param plan The plan.
 * @param input The confirmation.
 * @param now The instant.
 * @returns The wave and its number of mails.
 */
// oxlint-disable-next-line max-params -- the transaction, the actor, the plan, the input and the clock
async function createWave(
	tx: Db,
	actor: Principal,
	plan: WavePlan,
	input: Readonly<WaveConfirmation>,
	now: Date,
): Promise<{ waveId: string; mails: number }> {
	await holdOccasion(tx, plan.occasion);
	const waveId = await insertWaveRow(tx, actor, plan, input);
	if (waveId === null) return madeWave(tx, input.requestId, plan.occasion.id);
	await linkAttachments(tx, plan, waveId);
	await insertEntries(tx, plan, { id: waveId, notBefore: input.notBefore ?? now });
	const mails = plan.mails.length;
	await writeAudit(tx, {
		action: 'wave.created',
		actorUserId: actor.userId,
		details: { mails, occasionId: plan.occasion.id },
		target: `wave:${waveId}`,
	});
	return { mails, waveId };
}

/**
 * Plans a confirmed wave; when its files are gone because a confirmation of the same flow ended
 * meanwhile and took them with its wave, that wave is the answer.
 *
 * @param db The database.
 * @param actor Who confirms.
 * @param input The confirmation.
 * @param appOrigin The origin of the app.
 * @param now The instant.
 * @returns The plan, or the flow's wave.
 */
// oxlint-disable-next-line max-params -- the parameters of `confirmWave`
async function planOrMade(
	db: Db,
	actor: Principal,
	input: Readonly<WaveConfirmation>,
	appOrigin: string,
	now: Date,
): Promise<WavePlan | { waveId: string; mails: number }> {
	try {
		return await planWave(db, actor, input, appOrigin, now);
	} catch (error) {
		const made =
			error instanceof WaveAttachmentsGoneError
				? await waveOfRequest(db, input.requestId, input.occasionId)
				: null;
		if (made === null) throw error;
		return made;
	}
}

/**
 * Confirms a wave (Design 10.5, 11.1): compiles the template, plans the mails and makes the wave
 * with its entries in one transaction. A problem of the template or the selection, attachments
 * too large for Graph or a start out of range refuse it before any entry exists. A confirmation
 * of a flow that made its wave already gets that wave.
 *
 * @param db The database.
 * @param actor Who sends; needs `send` in the occasion's area.
 * @param input The occasion, the selection, the attachments, the flow's key and the start.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @param now The instant.
 * @returns The wave and its number of mails, or why it was refused.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `send` in the occasion's area.
 * @throws {OccasionInvalidError} When the occasion is archived (`archived`).
 * @throws {OccasionChangedError} When the occasion changed while the wave was made.
 * @throws {WaveAttachmentsGoneError} When a chosen file is no free attachment of the occasion.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function confirmWave(
	db: Db,
	actor: Principal,
	input: Readonly<WaveConfirmation>,
	appOrigin: string,
	now: Date,
): Promise<ConfirmedWave> {
	const occasion = await sendableOccasion(db, actor, input.occasionId);
	const made = await waveOfRequest(db, input.requestId, occasion.id);
	if (made !== null) return made;
	if (!inSchedule(input.notBefore, now)) return { refused: 'scheduleOutOfRange' };
	const plan = await planOrMade(db, actor, input, appOrigin, now);
	if ('waveId' in plan) return plan;
	if (plan.problem !== null) return { refused: plan.problem };
	if (graphTooLarge(plan, appOrigin, now)) return { refused: 'graphTooLarge' };
	return db.transaction(async (tx) => createWave(tx, actor, plan, input, now));
}

export { confirmWave, summarizeWave };
export type {
	ConfirmedWave,
	WaveConfirmation,
	WaveProblem,
	WaveRefusal,
	WaveSummary,
	WaveSummaryInput,
};
