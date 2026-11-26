/*
 * The expected refusals of the attachment functions as the results the server functions return.
 * A missing right still throws `ForbiddenError`, as in every server function.
 */
import { UnknownAreaError } from '@/server/contacts/errors';
import type { Db } from '@/server/db/client';
import { OccasionNotFoundError } from '@/server/occasions/errors';
import type { Principal } from '@/server/permissions/principal';
import { StorageNotConfiguredError } from '@/server/storage/storage';
import type { ObjectStorage } from '@/server/storage/storage';

import { removeAttachment, storeAttachment } from './attachments';
import type { AttachmentRecord } from './attachments';
import { AttachmentInvalidError, AttachmentLockedError, AttachmentNotFoundError } from './errors';
import type { AttachmentProblem } from './errors';

/** Why an upload or a removal was refused. */
type AttachmentFailure = Readonly<
	| { ok: false; failure: 'gone' | 'locked' | 'storageMissing' }
	| { ok: false; failure: 'invalid'; problem: AttachmentProblem }
>;

type UploadAttachmentResult =
	| Readonly<{ ok: true; attachment: AttachmentRecord }>
	| AttachmentFailure;
type RemoveAttachmentResult = Readonly<{ ok: true }> | AttachmentFailure;

function attachmentFailure(error: unknown): AttachmentFailure | null {
	if (error instanceof AttachmentInvalidError) {
		return { failure: 'invalid', ok: false, problem: error.reason };
	}
	if (
		error instanceof AttachmentNotFoundError ||
		error instanceof OccasionNotFoundError ||
		error instanceof UnknownAreaError
	) {
		return { failure: 'gone', ok: false };
	}
	if (error instanceof AttachmentLockedError) return { failure: 'locked', ok: false };
	if (error instanceof StorageNotConfiguredError) return { failure: 'storageMissing', ok: false };
	return null;
}

/**
 * Stores an upload and turns the expected refusals into results.
 *
 * @param db The database.
 * @param storage The object storage, null when none is set up.
 * @param actor Who uploads.
 * @param occasionId The occasion.
 * @param file The file's name and bytes.
 * @returns The attachment, or why it was refused.
 */
// oxlint-disable-next-line max-params -- the same parameters as `storeAttachment`
async function uploadAttachmentResult(
	db: Db,
	storage: ObjectStorage | null,
	actor: Principal,
	occasionId: string,
	file: Readonly<{ name: string; bytes: Uint8Array }>,
): Promise<UploadAttachmentResult> {
	if (storage === null) return { failure: 'storageMissing', ok: false };
	try {
		return { attachment: await storeAttachment(db, storage, actor, occasionId, file), ok: true };
	} catch (error) {
		const failure = attachmentFailure(error);
		if (failure === null) throw error;
		return failure;
	}
}

/**
 * Removes an attachment and turns the expected refusals into results.
 *
 * @param db The database.
 * @param storage The object storage, null when none is set up.
 * @param actor Who removes.
 * @param id The attachment.
 * @returns Whether it was removed, or why not.
 */
// oxlint-disable-next-line max-params -- the same parameters as `removeAttachment`
async function removeAttachmentResult(
	db: Db,
	storage: ObjectStorage | null,
	actor: Principal,
	id: string,
): Promise<RemoveAttachmentResult> {
	if (storage === null) return { failure: 'storageMissing', ok: false };
	try {
		await removeAttachment(db, storage, actor, id);
		return { ok: true };
	} catch (error) {
		const failure = attachmentFailure(error);
		if (failure === null) throw error;
		return failure;
	}
}

export { attachmentFailure, removeAttachmentResult, uploadAttachmentResult };
export type { AttachmentFailure, RemoveAttachmentResult, UploadAttachmentResult };
