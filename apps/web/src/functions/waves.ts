import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import type { AppContext } from '@/platform/context';
import type { RemoveAttachmentResult, UploadAttachmentResult } from '@/server/attachments/failures';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@/server/attachments/limits';
import { contactListQuerySchema, MAX_SEARCH_LENGTH } from '@/server/contacts/list-query';
import type {
	ConfirmWaveResult,
	RecipientPreviewResult,
	ResendUncertainResult,
	SearchRecipientsResult,
	SendTestMailResult,
	StopWaveResult,
	SummarizeWaveResult,
} from '@/server/waves/failures';
import type { SendFlowPage } from '@/server/waves/send-flow-page';

/*
 * The server functions of the send flow: its page, the search and the preview of recipients, the
 * attachments, the test mail, the summary of a wave and its confirmation, stopping a wave and
 * sending an uncertain entry again. Server modules are imported inside the handlers, so they stay
 * out of the client bundle. Each handler authorizes itself from the session principal. The file
 * goes as form data, so the request body limit answers an oversized upload before the function
 * runs. The selection of the recipients and the search terms go by POST, never into a URL.
 */

/** The longest id of an attachment (22 characters) with room to spare. */
const MAX_ID_LENGTH = 64;
/** The most contacts a selection one by one names: both kinds of a club at the import's limit. */
const MAX_SELECTED_CONTACTS = 20_000;
/** The longest id the page looks at; ids are 36 characters. */
const MAX_PAGE_ID_LENGTH = 100;

const removeRequest = z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) });

/** The selection of the recipients: the search and the filters of the contact list. */
const selectionRequest = z.object({
	contactIds: z.array(z.uuid()).max(MAX_SELECTED_CONTACTS).nullable(),
	filters: contactListQuerySchema.shape.filters.pick({ group: true, tag: true }),
	kind: z.enum(['member', 'partner', 'both']),
	query: contactListQuerySchema.shape.query,
});
const summaryRequest = z.object({
	attachmentIds: z.array(z.string().min(1).max(MAX_ID_LENGTH)).max(MAX_ATTACHMENTS),
	occasionId: z.uuid(),
	selection: selectionRequest,
});
const pageRequest = z.object({ id: z.string().max(MAX_PAGE_ID_LENGTH) });
const searchRequest = z.object({
	occasionId: z.uuid(),
	selection: selectionRequest,
	term: z.string().max(MAX_SEARCH_LENGTH),
});
const previewRequest = z.object({
	contactId: z.uuid(),
	occasionId: z.uuid(),
	selection: selectionRequest,
});
const testMailRequest = z.object({
	attachmentIds: summaryRequest.shape.attachmentIds,
	contactId: z.uuid(),
	occasionId: z.uuid(),
});
const stopRequest = z.object({ waveId: z.uuid() });
const resendRequest = z.object({ entryId: z.uuid() });
const confirmRequest = summaryRequest.extend({
	/** Null: at once. */
	notBefore: z.date().nullable(),
	/** The key of the flow, made by the browser when it opened (plan decision 18). */
	requestId: z.uuid(),
});

/**
 * The page of the send flow. An occasion that does not exist, one the user may not send for and
 * an archived one are "not found", like the occasion page does for one it may not read.
 */
const loadSendFlow = createServerFn({ method: 'GET' })
	.validator(pageRequest)
	.handler(async ({ data }): Promise<SendFlowPage> => {
		const [
			{ requireRequestPrincipal },
			{ loadSendFlowPage },
			{ ForbiddenError },
			{ OccasionInvalidError, OccasionNotFoundError },
		] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/waves/send-flow-page'),
			import('@/server/permissions/principal'),
			import('@/server/occasions/errors'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
		if (!z.uuid().safeParse(data.id).success) throw notFound();
		try {
			return await loadSendFlowPage(context.db, principal, data.id, context.env.appUrl.origin);
		} catch (error) {
			const hidden =
				error instanceof OccasionNotFoundError ||
				error instanceof ForbiddenError ||
				error instanceof OccasionInvalidError;
			// oxlint-disable-next-line typescript/only-throw-error -- see above
			if (hidden) throw notFound();
			throw error;
		}
	});

/** Searches the contacts of a selection, for single picks and for the preview. */
const searchRecipients = createServerFn({ method: 'POST' })
	.validator(searchRequest)
	.handler(async ({ data }): Promise<SearchRecipientsResult> => {
		const [{ requireRequestPrincipal }, { searchRecipientsResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/waves/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		return searchRecipientsResult(context.db, principal, data, new Date());
	});

/**
 * The values the preview shows for a contact of the selection, in the user's view; for a circular
 * those of the contact that fills the mail of its address, with who shares it.
 */
const loadRecipientValues = createServerFn({ method: 'POST' })
	.validator(previewRequest)
	.handler(async ({ data }): Promise<RecipientPreviewResult> => {
		const [{ requireRequestPrincipal }, { recipientPreviewResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/waves/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		return recipientPreviewResult(context.db, principal, data, new Date());
	});

/**
 * Sends the test mail to the signed-in user, at once through the occasion's sender; the request
 * waits for the provider's answer.
 */
const sendTestMail = createServerFn({ method: 'POST' })
	.validator(testMailRequest)
	.handler(async ({ data }): Promise<SendTestMailResult> => {
		const [{ requireRequestPrincipal }, { sendTestMailResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/waves/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const deps = {
			db: context.db,
			env: context.env,
			fetch: globalThis.fetch,
			now: () => new Date(),
			storage: context.storage,
		};
		return sendTestMailResult(deps, principal, data);
	});

interface UploadAttachmentRequest {
	readonly file: File;
	readonly occasionId: string;
}

/**
 * Reads the upload form: a file and the occasion.
 *
 * @param data What the server function received.
 * @returns The request.
 * @throws {Error} For anything but such a form.
 */
function parseUploadForm(data: unknown): UploadAttachmentRequest {
	if (!(data instanceof FormData)) throw new TypeError('An upload is form data.');
	const file = data.get('file');
	if (!(file instanceof File)) throw new TypeError('An upload has a file.');
	return { file, occasionId: z.uuid().parse(data.get('occasionId')) };
}

/** Stores a file for the next wave of an occasion; refusals come back as results. */
const uploadAttachment = createServerFn({ method: 'POST' })
	.validator(parseUploadForm)
	.handler(async ({ data }): Promise<UploadAttachmentResult> => {
		const [{ requireRequestPrincipal }, { uploadAttachmentResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/attachments/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		// Refuse by the declared size before the bytes are read; `storeAttachment` checks the real ones.
		if (data.file.size > MAX_ATTACHMENT_BYTES) {
			return { failure: 'invalid', ok: false, problem: 'size' };
		}
		const bytes = new Uint8Array(await data.file.arrayBuffer());
		return uploadAttachmentResult(context.db, context.storage, principal, data.occasionId, {
			bytes,
			name: data.file.name,
		});
	});

/** Removes an attachment that has no wave yet. */
const removeAttachment = createServerFn({ method: 'POST' })
	.validator(removeRequest)
	.handler(async ({ data }): Promise<RemoveAttachmentResult> => {
		const [{ requireRequestPrincipal }, { removeAttachmentResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/attachments/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		return removeAttachmentResult(context.db, context.storage, principal, data.id);
	});

/** The summary of the wave a confirmation would make; refusals come back as results. */
const summarizeWave = createServerFn({ method: 'POST' })
	.validator(summaryRequest)
	.handler(async ({ data }): Promise<SummarizeWaveResult> => {
		const [{ requireRequestPrincipal }, { summarizeWaveResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/waves/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		return summarizeWaveResult(context.db, principal, data, context.env.appUrl.origin, new Date());
	});

/**
 * Starts the first mails of a wave sent at once in the background (Design 8.7): a short run of the
 * outbox on a database of its own, with the subrequests of this invocation.
 *
 * @param context The app context of the request.
 */
async function kickAfterConfirmation(
	context: Readonly<Pick<AppContext, 'env' | 'platform' | 'storage'>>,
): Promise<void> {
	const [{ openOwnDb }, { invocationBudget }, { kickOutbox, kickRun }, { kickSteps }] =
		await Promise.all([
			import('@/platform/context'),
			import('@/platform/subrequests'),
			import('@/server/sending/outbox-step'),
			import('@/server/tick/steps'),
		]);
	const { env, platform, storage } = context;
	kickOutbox(
		platform,
		kickRun({
			env,
			openDb: async () => openOwnDb(env),
			steps: kickSteps,
			storage,
			subrequests: invocationBudget(platform.name),
		}),
	);
}

/**
 * Confirms a wave. A second confirmation of the same flow gets the same wave. A wave sent at once
 * starts its first mails right after the response.
 */
const confirmWave = createServerFn({ method: 'POST' })
	.validator(confirmRequest)
	.handler(async ({ data }): Promise<ConfirmWaveResult> => {
		const [{ requireRequestPrincipal }, { confirmWaveResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/waves/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const result = await confirmWaveResult(
			context.db,
			principal,
			data,
			context.env.appUrl.origin,
			new Date(),
		);
		if (result.ok && data.notBefore === null) await kickAfterConfirmation(context);
		return result;
	});

/** Stops a wave: its planned mails are cancelled; mails on their way finish. Needs `send`. */
const stopWave = createServerFn({ method: 'POST' })
	.validator(stopRequest)
	.handler(async ({ data }): Promise<StopWaveResult> => {
		const [{ requireRequestPrincipal }, { stopWaveResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/waves/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		return stopWaveResult(context.db, principal, data.waveId);
	});

/**
 * Sends an uncertain entry of a wave again, after a person checked it (Design 8.5): the next run
 * of the outbox takes it. Needs `send`.
 */
const resendUncertain = createServerFn({ method: 'POST' })
	.validator(resendRequest)
	.handler(async ({ data }): Promise<ResendUncertainResult> => {
		const [{ requireRequestPrincipal }, { resendUncertainResult }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/waves/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		return resendUncertainResult(context.db, principal, data.entryId);
	});

export {
	confirmWave,
	loadRecipientValues,
	loadSendFlow,
	removeAttachment,
	resendUncertain,
	searchRecipients,
	sendTestMail,
	stopWave,
	summarizeWave,
	uploadAttachment,
};
export type { SendFlowPage } from '@/server/waves/send-flow-page';
