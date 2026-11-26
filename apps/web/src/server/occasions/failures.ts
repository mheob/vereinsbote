/*
 * The expected refusals of the occasion functions as the results the server functions return.
 * Anything else is no expected refusal and stays an error.
 */
import { UnknownAreaError } from '@/server/contacts/errors';

import {
	OccasionChangedError,
	OccasionInvalidError,
	OccasionNameTakenError,
	OccasionNotFoundError,
} from './errors';
import type { OccasionProblem } from './errors';

/** Why a change of an occasion was refused. */
type OccasionFailure = Readonly<
	| { ok: false; failure: 'nameTaken' | 'changed' | 'gone' }
	| { ok: false; failure: 'invalid'; problem: OccasionProblem }
>;

/**
 * The result for an error of creating, changing or removing an occasion.
 *
 * @param error What was thrown.
 * @returns The failure, or null when the error is not an expected refusal.
 */
function occasionFailure(error: unknown): OccasionFailure | null {
	if (error instanceof OccasionNameTakenError) return { failure: 'nameTaken', ok: false };
	if (error instanceof OccasionChangedError) return { failure: 'changed', ok: false };
	if (error instanceof OccasionNotFoundError || error instanceof UnknownAreaError) {
		return { failure: 'gone', ok: false };
	}
	if (error instanceof OccasionInvalidError) {
		return { failure: 'invalid', ok: false, problem: error.problem };
	}
	return null;
}

export { occasionFailure };
export type { OccasionFailure };
