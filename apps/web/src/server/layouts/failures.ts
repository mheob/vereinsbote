/*
 * The expected refusals of the layout functions as the results the server functions return.
 * Anything else is no expected refusal and stays an error.
 */
import {
	LayoutChangedError,
	LayoutInUseError,
	LayoutNameInvalidError,
	LayoutNameTakenError,
	LayoutNotFoundError,
} from '@/server/templates/errors';

/** Why a change of a layout was refused; `inUse` says how many templates use the layout. */
type LayoutFailure = Readonly<
	| { ok: false; failure: 'nameTaken' | 'nameInvalid' | 'changed' | 'gone' }
	| { ok: false; failure: 'inUse'; templates: number }
>;

/**
 * The result for an error of creating, replacing or deleting a layout.
 *
 * @param error What was thrown.
 * @returns The failure, or null when the error is not an expected refusal.
 */
function layoutFailure(error: unknown): LayoutFailure | null {
	if (error instanceof LayoutNameTakenError) return { failure: 'nameTaken', ok: false };
	if (error instanceof LayoutNameInvalidError) return { failure: 'nameInvalid', ok: false };
	if (error instanceof LayoutChangedError) return { failure: 'changed', ok: false };
	if (error instanceof LayoutNotFoundError) return { failure: 'gone', ok: false };
	if (error instanceof LayoutInUseError) {
		return { failure: 'inUse', ok: false, templates: error.templates };
	}
	return null;
}

export { layoutFailure };
export type { LayoutFailure };
