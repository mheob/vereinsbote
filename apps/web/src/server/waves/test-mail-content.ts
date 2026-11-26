/*
 * What a test mail carries (Design 10.4): the occasion's template compiled as a wave sends it,
 * filled with the values of the contact the preview shows (`previewValues`, the user's view) and
 * with the unsubscribe link of test mails, the files of the flow, „[Test] “ before the subject,
 * from the occasion's sender to the user's own address. Nothing here sends.
 */
import { UNSUBSCRIBE_URL_KEY } from '@/mail/placeholders/registry';
import { fillMail } from '@/mail/render/fill';
import type { FilledMail } from '@/mail/render/fill';
import { TEST_UNSUBSCRIBE_PATH } from '@/paths';
import { AttachmentMissingError, readAttachments } from '@/server/attachments/attachments';
import { ContactNotFoundError } from '@/server/contacts/errors';
import type { Db } from '@/server/db/client';
import type { OccasionRecord } from '@/server/occasions/occasions';
import type { Principal } from '@/server/permissions/principal';
import { SenderNotFoundError } from '@/server/sending/errors';
import { loadSender } from '@/server/sending/senders';
import type { SenderSummary } from '@/server/sending/senders';
import { newMessageId } from '@/server/sending/transport';
import type { MailAttachment, OutgoingMail } from '@/server/sending/transport';
import { StorageNotConfiguredError } from '@/server/storage/storage';
import type { ObjectStorage } from '@/server/storage/storage';
import { previewValues } from '@/server/templates/preview-values';
import { findUserById } from '@/server/users/repo';

import { WaveAttachmentsGoneError } from './errors';
import { compileFor, freeAttachments } from './waves';

/**
 * Why a test mail was refused: the user's hour is used up, the mail is too large for Graph, the
 * template does not compile for the occasion, or the contact lacks required values (`keys`).
 */
type TestMailRefusal = 'compile' | 'graphTooLarge' | 'missing' | 'rate';

/** A refused test mail; `keys` names the missing values of `missing`. */
interface RefusedTestMail {
	refused: TestMailRefusal;
	keys?: string[];
}

/** A test mail ready to go, with its sender. */
interface BuiltTestMail {
	readonly mail: OutgoingMail;
	readonly sender: SenderSummary;
}

/** What building a test mail reads. */
type ContentDeps = Readonly<{ db: Db; storage: ObjectStorage | null; appOrigin: string }>;

/** What every test mail's subject starts with. */
const SUBJECT_PREFIX = '[Test] ';

/**
 * The address of the signed-in user.
 *
 * @param db The database.
 * @param userId The user.
 * @returns The address.
 * @throws {Error} When the user does not exist; a session has one.
 */
async function ownAddress(db: Db, userId: string): Promise<string> {
	const found = await findUserById(db, userId);
	if (found === null) throw new Error('The user of the session does not exist.');
	return found.email;
}

/**
 * The files of the flow, read from the storage.
 *
 * @param deps The database and the storage.
 * @param occasion The occasion.
 * @param ids The attachments the flow chose.
 * @returns The files.
 * @throws {WaveAttachmentsGoneError} When a file is no free attachment of the occasion or its
 *   object is gone.
 * @throws {StorageNotConfiguredError} When there are files but no storage.
 */
async function filesOf(
	deps: ContentDeps,
	occasion: Readonly<OccasionRecord>,
	ids: readonly string[],
): Promise<MailAttachment[]> {
	const chosen = await freeAttachments(deps.db, occasion.id, ids, false);
	if (chosen.length === 0) return [];
	if (deps.storage === null) throw new StorageNotConfiguredError();
	const { areaId } = occasion;
	const records = chosen.map(({ id, name, size, type }) => ({
		areaId,
		id,
		name,
		size,
		type,
		waveId: null,
	}));
	try {
		return await readAttachments(deps.storage, records);
	} catch (error) {
		if (error instanceof AttachmentMissingError) throw new WaveAttachmentsGoneError();
		throw error;
	}
}

/**
 * The template filled for the contact, with the test unsubscribe link in its slot.
 *
 * @param db The database.
 * @param actor Who tests; the values are those the user may see.
 * @param occasion The occasion.
 * @param fill The contact and the link (null for an occasion without the link).
 * @param fill.contactId The contact.
 * @param fill.link The link, or null.
 * @param appOrigin The origin of the app.
 * @returns Subject, HTML and text, or why there are none.
 * @throws {ContactNotFoundError} When the contact is gone.
 */
// oxlint-disable-next-line max-params -- the database, the user, the occasion, the fill and the origin
async function filledFor(
	db: Db,
	actor: Principal,
	occasion: Readonly<OccasionRecord>,
	fill: Readonly<{ contactId: string; link: string | null }>,
	appOrigin: string,
): Promise<{ content: FilledMail } | RefusedTestMail> {
	const template = await compileFor(db, actor, occasion, appOrigin);
	if (template.mail === null) return { refused: 'compile' };
	const { salutationTexts, templateId } = template;
	const contact = await previewValues(db, actor, templateId, fill.contactId, salutationTexts);
	if (contact === null) throw new ContactNotFoundError();
	const values = new Map(Object.entries(contact));
	if (fill.link !== null) values.set(UNSUBSCRIBE_URL_KEY, fill.link);
	const filled = fillMail(template.mail, values);
	return filled.ok ? { content: filled.mail } : { keys: filled.missing, refused: 'missing' };
}

/**
 * The test mail as a provider takes it: from the sender (its reply address, no archive copy), to
 * the user, with a fresh Message-ID and idempotency key.
 *
 * @param sender The sender.
 * @param content The filled mail, the link, the files and the user's address.
 * @returns The mail.
 */
function outgoingTestMail(
	sender: Readonly<SenderSummary>,
	content: Readonly<{
		filled: Readonly<FilledMail>;
		link: string | null;
		files: readonly MailAttachment[];
		to: string;
	}>,
): OutgoingMail {
	const { filled, files, link, to } = content;
	return {
		attachments: files,
		bcc: null,
		from: { address: sender.email, name: sender.displayName },
		html: filled.html,
		idempotencyKey: crypto.randomUUID(),
		kind: 'regular',
		listUnsubscribe: link,
		messageId: newMessageId(sender.email),
		replyTo: sender.replyTo,
		subject: `${SUBJECT_PREFIX}${filled.subject}`,
		text: filled.text,
		to,
	};
}

/**
 * Builds the test mail of a flow.
 *
 * @param deps The database, the storage and the origin of the app.
 * @param actor Who tests; the mail goes to their address.
 * @param occasion The occasion.
 * @param input The contact and the files.
 * @param input.contactId The contact whose values fill the mail.
 * @param input.attachmentIds The files of the flow.
 * @returns The mail with its sender, or why there is none.
 * @throws {ContactNotFoundError} When the contact is gone.
 * @throws {WaveAttachmentsGoneError} When a file of the flow is gone.
 * @throws {SenderNotFoundError} When the occasion's sender is gone.
 */
// oxlint-disable-next-line max-params -- the dependencies, the user, the occasion and the input
async function buildTestMail(
	deps: ContentDeps,
	actor: Principal,
	occasion: Readonly<OccasionRecord>,
	input: Readonly<{ contactId: string; attachmentIds: readonly string[] }>,
): Promise<BuiltTestMail | RefusedTestMail> {
	const { appOrigin, db } = deps;
	const link = occasion.unsubscribe ? `${appOrigin}${TEST_UNSUBSCRIBE_PATH}` : null;
	const filled = await filledFor(
		db,
		actor,
		occasion,
		{ contactId: input.contactId, link },
		appOrigin,
	);
	if ('refused' in filled) return filled;
	const sender = await loadSender(db, occasion.senderId);
	if (sender === null) throw new SenderNotFoundError();
	const files = await filesOf(deps, occasion, input.attachmentIds);
	const to = await ownAddress(db, actor.userId);
	return { mail: outgoingTestMail(sender, { files, filled: filled.content, link, to }), sender };
}

export { buildTestMail, ownAddress };
export type { BuiltTestMail, RefusedTestMail, TestMailRefusal };
