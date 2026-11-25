/*
 * What the preview knows about the values of the picked real contact: nothing yet, the values, or
 * that loading them failed. Pure, so the three states are tested without React.
 */

/** The last answer for one contact: its values, or a failed call. */
type ContactValuesResult =
	| { readonly contactId: string; readonly values: ReadonlyMap<string, string> }
	| { readonly contactId: string; readonly failed: true };

/** What the panel shows for the picked contact. */
type ContactValuesState =
	| { readonly status: 'idle' }
	| { readonly status: 'loading' }
	| { readonly status: 'failed' }
	| { readonly status: 'ready'; readonly values: ReadonlyMap<string, string> };

/**
 * The state for a picked contact.
 *
 * @param contactId The contact whose values are wanted, or null for none (the sample is chosen).
 * @param result The last answer, for whichever contact.
 * @returns `idle` without a contact; `loading` until an answer for this contact arrives; then its
 *   values or the failure. An answer for another contact does not count.
 */
function contactValuesState(
	contactId: string | null,
	result: Readonly<ContactValuesResult> | null,
): ContactValuesState {
	if (contactId === null) return { status: 'idle' };
	if (result?.contactId !== contactId) return { status: 'loading' };
	return 'failed' in result ? { status: 'failed' } : { status: 'ready', values: result.values };
}

export { contactValuesState };
export type { ContactValuesResult, ContactValuesState };
