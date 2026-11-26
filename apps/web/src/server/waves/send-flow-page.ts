/*
 * What the page of the send flow loads (Design 10): the occasion and its sender, the template with
 * what the browser's preview compiles it from (the same pieces as the editor's preview), the
 * groups and tags the recipients can be filtered by, the files the occasion holds for its next
 * wave, and the address the test mail goes to. Needs `send` in the occasion's area and the right
 * to list contacts; an archived occasion has no send flow.
 */
import { asc, and, eq, isNull } from 'drizzle-orm';

import type { Brand } from '@/mail/brand/brand-schema';
import type { MediaInfo } from '@/mail/render/compile';
import type { LayoutHtml } from '@/mail/templates/mail-source';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { toRecord } from '@/server/attachments/attachments';
import type { AttachmentRecord } from '@/server/attachments/attachments';
import { assertCanList, loadContactAccess } from '@/server/contacts/access';
import { listGroups } from '@/server/contacts/contacts';
import { listTags } from '@/server/contacts/partners';
import type { Db } from '@/server/db/client';
import { attachments } from '@/server/db/schema';
import type { OccasionKind } from '@/server/occasions/limits';
import type { Principal } from '@/server/permissions/principal';
import type { ConnectionKind } from '@/server/sending/connections';
import { SenderNotFoundError } from '@/server/sending/errors';
import { loadSender } from '@/server/sending/senders';
import { loadTemplateEditorData } from '@/server/templates/editor-data';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import { ownAddress } from './test-mail-content';
import { sendableOccasion } from './waves';

/** The template as the browser's preview compiles it (`mailSourceOf`). */
interface SendFlowTemplate {
	readonly input: TemplateInput;
	/** The global layout the template chose, if any. */
	readonly layouts: readonly LayoutHtml[];
	/** The library images the template shows, by id. */
	readonly media: Readonly<Record<string, MediaInfo>>;
}

interface SendFlowPage {
	readonly occasion: Readonly<{
		id: string;
		name: string;
		kind: OccasionKind;
		unsubscribe: boolean;
	}>;
	/** The sender as „Anzeigename <adresse>“ and its provider. */
	readonly sender: Readonly<{ label: string; provider: ConnectionKind }>;
	readonly template: SendFlowTemplate;
	readonly brand: Brand;
	/** The placeholders of the area, to name a missing custom field. */
	readonly placeholders: readonly EditorPlaceholder[];
	/** The groups of the members and the tags of the partners, for the filters. */
	readonly groups: readonly string[];
	readonly tags: readonly string[];
	/** The files the occasion holds for its next wave, oldest first. */
	readonly attachments: readonly Readonly<AttachmentRecord>[];
	/** Where the test mail goes: the user's own address. */
	readonly ownAddress: string;
	/** The origin of the app, for the preview's image addresses. */
	readonly appOrigin: string;
}

/**
 * The files an occasion holds for its next wave.
 *
 * @param db The database.
 * @param occasionId The occasion.
 * @returns The files, oldest first.
 */
async function freeAttachmentsOf(db: Db, occasionId: string): Promise<AttachmentRecord[]> {
	const rows = await db
		.select()
		.from(attachments)
		.where(and(eq(attachments.occasionId, occasionId), isNull(attachments.waveId)))
		.orderBy(asc(attachments.createdAt), asc(attachments.id));
	return rows.map((row) => toRecord(row));
}

/**
 * Loads the page of the send flow. Runs several queries: never inside a transaction.
 *
 * @param db The database.
 * @param actor Who sends; needs `send` in the occasion's area.
 * @param occasionId The occasion.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @returns The page.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `send` in the occasion's area or the right to list contacts.
 * @throws {OccasionInvalidError} When the occasion is archived (`archived`).
 */
// oxlint-disable-next-line max-params -- the database, the user, the occasion and the origin
async function loadSendFlowPage(
	db: Db,
	actor: Principal,
	occasionId: string,
	appOrigin: string,
): Promise<SendFlowPage> {
	const occasion = await sendableOccasion(db, actor, occasionId);
	assertCanList(await loadContactAccess(db, actor));
	const editor = await loadTemplateEditorData(db, actor, occasion.templateId, appOrigin);
	const sender = await loadSender(db, occasion.senderId);
	if (sender === null) throw new SenderNotFoundError();
	const { body, name, preheader, salutationForm, salutationTexts, subject } = editor.template;
	const chosen =
		body.kind === 'blocks' && body.layout.kind === 'shared' ? body.layout.layoutId : '';
	return {
		appOrigin,
		attachments: await freeAttachmentsOf(db, occasion.id),
		brand: editor.brand,
		groups: await listGroups(db, 'member'),
		occasion: {
			id: occasion.id,
			kind: occasion.kind,
			name: occasion.name,
			unsubscribe: occasion.unsubscribe,
		},
		ownAddress: await ownAddress(db, actor.userId),
		placeholders: editor.placeholders,
		sender: { label: `${sender.displayName} <${sender.email}>`, provider: sender.connectionKind },
		tags: await listTags(db),
		template: {
			input: { body, name, preheader, salutationForm, salutationTexts, subject },
			layouts: editor.layouts
				.filter(({ id }) => id === chosen)
				.map(({ html, id }) => ({ html, id })),
			media: editor.media,
		},
	};
}

export { loadSendFlowPage };
export type { SendFlowPage, SendFlowTemplate };
