/*
 * The expected refusals of creating, duplicating and deleting a template as the results the
 * server functions return. Anything else is no expected refusal and stays an error.
 */
import { UnknownAreaError } from '@/server/contacts/errors';
import { StorageNotConfiguredError } from '@/server/storage/storage';

import {
	LayoutNotFoundError,
	TemplateChangedError,
	TemplateInvalidError,
	TemplateNameTakenError,
	TemplateNotFoundError,
} from './errors';
import { refusedPlaceholderKeys } from './refused-keys';

type CreateFailure = Readonly<{ ok: false; failure: 'nameTaken' | 'invalid' | 'gone' }>;

type DuplicateFailure = Readonly<
	| { ok: false; failure: 'nameTaken' | 'storageMissing' | 'gone' }
	| { ok: false; failure: 'forbiddenPlaceholders'; keys: readonly string[] }
>;

type DeleteFailure = Readonly<{ ok: false; failure: 'changed' | 'gone' }>;

/**
 * The result for an error of creating a template.
 *
 * @param error What was thrown.
 * @returns The failure, or null when the error is not an expected refusal.
 */
function createFailure(error: unknown): CreateFailure | null {
	if (error instanceof TemplateNameTakenError) return { failure: 'nameTaken', ok: false };
	if (error instanceof TemplateInvalidError) return { failure: 'invalid', ok: false };
	if (error instanceof UnknownAreaError || error instanceof LayoutNotFoundError) {
		return { failure: 'gone', ok: false };
	}
	return null;
}

/**
 * The result for an error of duplicating a template. Placeholders the target area does not allow
 * come with their keys; other problems of the copy are no expected refusal.
 *
 * @param error What was thrown.
 * @returns The failure, or null when the error is not an expected refusal.
 */
function duplicateFailure(error: unknown): DuplicateFailure | null {
	if (error instanceof TemplateNameTakenError) return { failure: 'nameTaken', ok: false };
	if (error instanceof StorageNotConfiguredError) return { failure: 'storageMissing', ok: false };
	if (error instanceof TemplateNotFoundError || error instanceof UnknownAreaError) {
		return { failure: 'gone', ok: false };
	}
	if (error instanceof TemplateInvalidError) {
		const keys = refusedPlaceholderKeys(error.problems);
		if (keys.length > 0) return { failure: 'forbiddenPlaceholders', keys, ok: false };
	}
	return null;
}

/**
 * The result for an error of deleting a template.
 *
 * @param error What was thrown.
 * @returns The failure, or null when the error is not an expected refusal.
 */
function deleteFailure(error: unknown): DeleteFailure | null {
	if (error instanceof TemplateNotFoundError) return { failure: 'gone', ok: false };
	if (error instanceof TemplateChangedError) return { failure: 'changed', ok: false };
	return null;
}

export { createFailure, deleteFailure, duplicateFailure };
export type { CreateFailure, DeleteFailure, DuplicateFailure };
