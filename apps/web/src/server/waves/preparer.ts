/*
 * The preparer of the outbox entries of a wave (Design 11.3, 12). Right before each mail it loads
 * the entry's contacts anew and checks each: it still exists, is mailable (suppression, address,
 * exit date by the club's day), has no opt-out of the occasion or the area, and its address is not
 * marked invalid. A personal mail follows its contact to a new address; a circular belongs to its
 * address, so a contact whose address changed drops out of it, and the next contact moves up. The
 * first contact left fills the wave's compiled mail with its current values, by the area's field
 * protection and without a user (`sendingValues`); the unsubscribe link names every contact left.
 *
 * Nothing here is random: the same entry and the same data give the same mail, so a retry repeats
 * the payload its idempotency key stands for (ruling R4). The wave, its sender, the values' context
 * and the wave's files are read once per run of the outbox and sender (`startRun`), not per mail:
 * on Cloudflare every read of a file counts against the invocation's subrequests.
 */
import { asc, eq } from 'drizzle-orm';

import { UNSUBSCRIBE_URL_KEY } from '@/mail/placeholders/registry';
import { fillMail } from '@/mail/render/fill';
import {
	AttachmentMissingError,
	readAttachments,
	toRecord,
} from '@/server/attachments/attachments';
import { normalizeEmail } from '@/server/auth/email';
import { todayInClubZone } from '@/server/contacts/calendar';
import type { Db } from '@/server/db/client';
import { attachments, waveContacts, waves } from '@/server/db/schema';
import type { Env } from '@/server/env';
import { SenderNotFoundError } from '@/server/sending/errors';
import { listUnsubscribeFits } from '@/server/sending/mime';
import type {
	ClaimedEntry,
	EntryPreparer,
	PrepareContext,
	PrepareEntry,
	PreparedMail,
} from '@/server/sending/outbox';
import { loadSender } from '@/server/sending/senders';
import type { SenderSummary } from '@/server/sending/senders';
import type { MailAttachment, OutgoingMail } from '@/server/sending/transport';
import { StorageNotConfiguredError } from '@/server/storage/storage';
import type { ObjectStorage } from '@/server/storage/storage';
import { sendingValueContext, sendingValues } from '@/server/templates/sending-values';
import type { SendingValueContext } from '@/server/templates/sending-values';
import { deriveUnsubscribeKey, unsubscribePayload } from '@/server/unsubscribe/token';
import { unsubscribeUrl } from '@/server/unsubscribe/url';

import { contactsWithMarks, exclusionOf } from './recipients';
import type { ContactRow, ExclusionReason, SelectedRow } from './recipients';

/** Why a contact of an entry gets no mail now: a reason of the summary, a new address, deleted. */
type SkipReason = ExclusionReason | 'addressChanged' | 'deleted';

/** The wave as its entries need it. */
type WaveRow = Pick<
	typeof waves.$inferSelect,
	'areaId' | 'compiled' | 'id' | 'kind' | 'occasionId' | 'salutationTexts' | 'unsubscribe'
>;

/** What the entries of a wave share; read once per run. */
interface WaveSetup {
	readonly wave: Readonly<WaveRow>;
	readonly sender: Readonly<SenderSummary>;
	readonly values: Readonly<SendingValueContext>;
	/** The files of the wave; null when one of them is gone from the storage. */
	readonly files: readonly MailAttachment[] | null;
	/** The key of the unsubscribe tokens; null for a wave without the link. */
	readonly unsubscribeKey: CryptoKey | null;
}

/** A contact of an entry as the confirmation recorded it. */
interface EntryContact {
	readonly contactId: string | null;
	/** The address at the confirmation, normalized. */
	readonly email: string;
}

/** The contacts of an entry that get its mail now and the address it goes to, or why none does. */
type Recipients =
	| {
			readonly kind: 'mail';
			readonly address: string;
			/** The contact whose values fill the mail; the first of `contacts`. */
			readonly first: ContactRow;
			readonly contacts: readonly ContactRow[];
	  }
	| { readonly kind: 'skip'; readonly reason: SkipReason };

/**
 * The files of a wave, in the order they were uploaded.
 *
 * @param db The database.
 * @param waveId The wave.
 * @param storage The object storage, or null when none is set up.
 * @returns The files; null when one of them is gone from the storage.
 * @throws {StorageNotConfiguredError} When the wave has files but no storage is set up.
 */
async function loadFiles(
	db: Db,
	waveId: string,
	storage: ObjectStorage | null,
): Promise<readonly MailAttachment[] | null> {
	const rows = await db
		.select()
		.from(attachments)
		.where(eq(attachments.waveId, waveId))
		.orderBy(asc(attachments.createdAt), asc(attachments.id));
	if (rows.length === 0) return [];
	if (storage === null) throw new StorageNotConfiguredError();
	try {
		return await readAttachments(
			storage,
			rows.map((row) => toRecord(row)),
		);
	} catch (error) {
		if (error instanceof AttachmentMissingError) return null;
		throw error;
	}
}

/**
 * Reads what the entries of a wave share.
 *
 * @param db The database.
 * @param entry The entry: its wave and its sender.
 * @param ctx The storage and the environment.
 * @returns The setup, or null when the wave is gone.
 * @throws {SenderNotFoundError} When the sender is gone.
 */
async function loadSetup(
	db: Db,
	entry: Readonly<ClaimedEntry>,
	ctx: Readonly<Pick<PrepareContext, 'env' | 'storage'>>,
): Promise<WaveSetup | null> {
	const [wave] = await db
		.select({
			areaId: waves.areaId,
			compiled: waves.compiled,
			id: waves.id,
			kind: waves.kind,
			occasionId: waves.occasionId,
			salutationTexts: waves.salutationTexts,
			unsubscribe: waves.unsubscribe,
		})
		.from(waves)
		.where(eq(waves.id, entry.sourceId));
	if (wave === undefined) return null;
	const sender = await loadSender(db, entry.senderId);
	if (sender === null) throw new SenderNotFoundError();
	const values = await sendingValueContext(db, wave.areaId);
	const files = await loadFiles(db, wave.id, ctx.storage);
	const unsubscribeKey = wave.unsubscribe ? await deriveUnsubscribeKey(ctx.env.appSecret) : null;
	return { files, sender, unsubscribeKey, values, wave };
}

/**
 * Why a contact of an entry gets no mail now.
 *
 * @param recorded The contact as the confirmation recorded it.
 * @param found The contact as it is now, with its marks; undefined when it was deleted.
 * @param circular Whether the entry is a circular, which belongs to its address.
 * @param today Today in the club's time zone.
 * @returns The reason, or null when the contact gets the mail.
 */
// oxlint-disable-next-line max-params -- the recorded contact, the current one, the kind and the day
function skipReasonOf(
	recorded: Readonly<EntryContact>,
	found: Readonly<SelectedRow> | undefined,
	circular: boolean,
	today: string,
): SkipReason | null {
	if (found === undefined) return 'deleted';
	const { contact, ...marks } = found;
	const excluded = exclusionOf(contact, marks, today);
	if (excluded !== null) return excluded;
	if (circular && normalizeEmail(contact.email ?? '') !== recorded.email) return 'addressChanged';
	return null;
}

/**
 * The contacts of an entry as the confirmation recorded them, in their order.
 *
 * @param db The database.
 * @param entryId The entry.
 * @returns The contacts.
 */
async function recordedContacts(db: Db, entryId: string): Promise<EntryContact[]> {
	return db
		.select({ contactId: waveContacts.contactId, email: waveContacts.email })
		.from(waveContacts)
		.where(eq(waveContacts.entryId, entryId))
		.orderBy(asc(waveContacts.position));
}

/**
 * The recorded contacts as they are now, with their marks, by id; a deleted one is missing.
 *
 * @param db The database.
 * @param wave The wave: its occasion and area.
 * @param recorded The recorded contacts.
 * @returns The current contacts by id.
 */
async function currentContacts(
	db: Db,
	wave: Readonly<WaveRow>,
	recorded: readonly Readonly<EntryContact>[],
): Promise<Map<string, SelectedRow>> {
	const ids = recorded.flatMap(({ contactId }) => (contactId === null ? [] : [contactId]));
	const rows = await contactsWithMarks(db, { areaId: wave.areaId, id: wave.occasionId }, ids);
	return new Map(rows.map((row) => [row.contact.id, row]));
}

/**
 * The contacts of an entry that get its mail now, in their order, and the address: a circular's
 * own, a personal mail's contact's current one. Without any, the reason of the first contact.
 *
 * @param recorded The contacts as the confirmation recorded them.
 * @param current The contacts as they are now, by id.
 * @param circular Whether the entry is a circular.
 * @param today Today in the club's time zone.
 * @returns The recipients, or why the entry is skipped.
 */
// oxlint-disable-next-line max-params -- the recorded and the current contacts, the kind and the day
function pickRecipients(
	recorded: readonly Readonly<EntryContact>[],
	current: ReadonlyMap<string, SelectedRow>,
	circular: boolean,
	today: string,
): Recipients {
	const left: ContactRow[] = [];
	const reasons: SkipReason[] = [];
	for (const each of recorded) {
		const found = each.contactId === null ? undefined : current.get(each.contactId);
		const reason = skipReasonOf(each, found, circular, today);
		if (reason !== null) reasons.push(reason);
		else if (found !== undefined) left.push(found.contact);
	}
	const [first] = left;
	if (first === undefined) return { kind: 'skip', reason: reasons[0] ?? 'deleted' };
	const address = circular ? (recorded[0]?.email ?? '') : normalizeEmail(first.email ?? '');
	return { address, contacts: left, first, kind: 'mail' };
}

/**
 * The unsubscribe link of a mail: it names every contact the mail goes to.
 *
 * @param setup The wave and its key.
 * @param contacts The contacts of the mail.
 * @param env The environment: the app's address.
 * @returns The link, or null for a wave without the link.
 */
async function linkOf(
	setup: Readonly<WaveSetup>,
	contacts: readonly ContactRow[],
	env: Env,
): Promise<string | null> {
	if (setup.unsubscribeKey === null) return null;
	const { areaId, occasionId } = setup.wave;
	const payload = unsubscribePayload({ areaId, occasionId }, contacts);
	return unsubscribeUrl(env.appUrl, setup.unsubscribeKey, payload);
}

/**
 * The values of a mail: those of the contact that fills it, and the unsubscribe link.
 *
 * @param setup What the wave's entries share.
 * @param first The contact that fills the mail.
 * @param link The unsubscribe link, or null.
 * @returns The value per placeholder key.
 */
function valuesOf(
	setup: Readonly<WaveSetup>,
	first: ContactRow,
	link: string | null,
): Map<string, string> {
	const values = sendingValues(setup.values, first, setup.wave.salutationTexts);
	if (link !== null) values.set(UNSUBSCRIBE_URL_KEY, link);
	return values;
}

/**
 * The mail as the outbox sends it: from the sender (its reply address and archive copy), with the
 * entry's Message-ID and its id as idempotency key, which the outbox sets once more anyway. A link
 * too long for the `List-Unsubscribe` line (a circular to many contacts at one address) stays in
 * the mail only, without the unsubscribe headers.
 *
 * @param sender The sender.
 * @param entry The entry.
 * @param content The address, the filled subject, HTML and text, the link and the files.
 * @returns The mail.
 */
function outgoingMail(
	sender: Readonly<SenderSummary>,
	entry: Readonly<ClaimedEntry>,
	content: Readonly<{
		address: string;
		subject: string;
		html: string;
		text: string;
		link: string | null;
		files: readonly MailAttachment[];
	}>,
): OutgoingMail {
	const { address, files, html, link, subject, text } = content;
	return {
		attachments: files,
		bcc: sender.archiveBcc,
		from: { address: sender.email, name: sender.displayName },
		html,
		idempotencyKey: entry.id,
		kind: 'regular',
		listUnsubscribe: link !== null && listUnsubscribeFits(link) ? link : null,
		messageId: entry.messageId,
		replyTo: sender.replyTo,
		subject,
		text,
		to: address,
	};
}

/**
 * Fills the wave's mail for its recipients with the first contact's values and the link.
 *
 * @param setup What the wave's entries share.
 * @param entry The entry.
 * @param recipients The contacts and the address.
 * @param env The environment.
 * @returns The mail, or the failure that names the first missing required value by its key, or a
 *   file gone from the storage.
 */
// oxlint-disable-next-line max-params -- the setup, the entry, the recipients and the environment
async function mailOf(
	setup: Readonly<WaveSetup>,
	entry: Readonly<ClaimedEntry>,
	recipients: Readonly<Extract<Recipients, { kind: 'mail' }>>,
	env: Env,
): Promise<PreparedMail> {
	const { files } = setup;
	if (files === null) return { code: 'attachmentMissing', kind: 'fail' };
	const { address, contacts, first } = recipients;
	const link = await linkOf(setup, contacts, env);
	const filled = fillMail(setup.wave.compiled, valuesOf(setup, first, link));
	if (!filled.ok) return { code: `missing:${filled.missing[0] ?? ''}`, kind: 'fail' };
	const mail = outgoingMail(setup.sender, entry, { ...filled.mail, address, files, link });
	return { kind: 'send', mail, recipient: address };
}

/**
 * Prepares an entry with the setup of its wave: checks its contacts, then fills its mail.
 *
 * @param setup What the wave's entries share, or null when the wave is gone.
 * @param db The database.
 * @param entry The entry.
 * @param ctx The instant and the environment.
 * @returns The mail, a skip or a failure.
 */
// oxlint-disable-next-line max-params -- the setup and the three parameters of a preparer
async function prepareWith(
	setup: Readonly<WaveSetup> | null,
	db: Db,
	entry: Readonly<ClaimedEntry>,
	ctx: Readonly<PrepareContext>,
): Promise<PreparedMail> {
	if (setup === null) return { code: 'waveGone', kind: 'fail' };
	const recorded = await recordedContacts(db, entry.id);
	const current = await currentContacts(db, setup.wave, recorded);
	const circular = setup.wave.kind === 'circular';
	const recipients = pickRecipients(recorded, current, circular, todayInClubZone(ctx.now));
	if (recipients.kind === 'skip') return recipients;
	return mailOf(setup, entry, recipients, ctx.env);
}

/**
 * Starts a run of the outbox. Each sender's lane keeps the setup of the wave it last sent (its
 * sender, values, files and key) for its following entries, so a wave's files are read once per
 * run, not per mail, also while the lanes of several senders take turns. Another wave of the same
 * sender replaces its lane's setup: the run holds at most one wave's files per sender, that is at
 * most the number of senders with due entries times 5 files of 4 MiB.
 *
 * @returns The prepare function of the run.
 */
function startWaveRun(): PrepareEntry {
	const held = new Map<
		string,
		{ readonly waveId: string; readonly setup: Promise<WaveSetup | null> }
	>();
	return async (db, entry, ctx) => {
		const { senderId, sourceId: waveId } = entry;
		const kept = held.get(senderId);
		const setup = kept?.waveId === waveId ? kept.setup : loadSetup(db, entry, ctx);
		held.set(senderId, { setup, waveId });
		return prepareWith(await setup, db, entry, ctx);
	};
}

/** Builds the mail of an outbox entry of a wave (`source` `wave`). */
const wavePreparer: EntryPreparer = {
	async prepare(db, entry, ctx) {
		return startWaveRun()(db, entry, ctx);
	},
	startRun: startWaveRun,
};

export { wavePreparer };
