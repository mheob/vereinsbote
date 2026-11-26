import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import type { RemoveAttachmentResult, UploadAttachmentResult } from '@/server/attachments/failures';
import { MAX_ATTACHMENT_BYTES } from '@/server/attachments/limits';

/*
 * The server functions of the send flow. Task 14 brings the attachments; the later tasks of
 * sub-plan 4b add the wave. Server modules are imported inside the handlers, so they stay out of
 * the client bundle. Each handler authorizes itself from the session principal. The file goes as
 * form data, so the request body limit answers an oversized upload before the function runs.
 */

/** The longest id of an attachment (22 characters) with room to spare. */
const MAX_ID_LENGTH = 64;

const removeRequest = z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) });

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

export { removeAttachment, uploadAttachment };
