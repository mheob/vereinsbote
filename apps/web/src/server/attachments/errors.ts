/* oxlint-disable max-classes-per-file -- the typed refusals of the attachment module live together */
/*
 * The expected refusals of the attachment module. The server functions turn them into results;
 * no message names a file or its content.
 */

/** Why a file was refused: it is no PDF, JPEG or PNG, too large, or the mail has too many. */
type AttachmentProblem = 'count' | 'size' | 'total' | 'type';

/** The file does not pass the checks; `reason` says which. */
class AttachmentInvalidError extends Error {
	public readonly reason: AttachmentProblem;

	public constructor(reason: AttachmentProblem) {
		super('The file is not an acceptable attachment.');
		this.name = 'AttachmentInvalidError';
		this.reason = reason;
	}
}

/** No attachment has the id, e.g. it was removed in another tab. */
class AttachmentNotFoundError extends Error {
	public constructor() {
		super('Unknown attachment.');
		this.name = 'AttachmentNotFoundError';
	}
}

/** The attachment hangs at a wave and can no longer be removed. */
class AttachmentLockedError extends Error {
	public constructor() {
		super('The attachment belongs to a wave.');
		this.name = 'AttachmentLockedError';
	}
}

/** The row exists, the stored object does not. */
class AttachmentMissingError extends Error {
	public constructor() {
		super('The stored attachment is missing.');
		this.name = 'AttachmentMissingError';
	}
}

export {
	AttachmentInvalidError,
	AttachmentLockedError,
	AttachmentMissingError,
	AttachmentNotFoundError,
};
export type { AttachmentProblem };
