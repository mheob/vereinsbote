/*
 * The recipients as the first step of the send flow holds them, and the selection the server takes
 * from them (`RecipientSelection`, Design 10.1): every contact of a kind that the search and the
 * filters find, or contacts picked one by one, of either kind. Pure, so the step's rules are
 * tested without React. The search and the filters go to the server by POST only.
 */
import type { RecipientChoice } from '@/server/waves/recipient-search';
import type { RecipientSelection } from '@/server/waves/recipients';

/** How the recipients are chosen. */
type SelectionMode = 'filter' | 'single';

/** The step's state: both modes keep their input while the other one is shown. */
interface SelectionDraft {
	readonly mode: SelectionMode;
	readonly kind: RecipientSelection['kind'];
	readonly query: string;
	/** A group of the members, or null for all. */
	readonly group: string | null;
	/** A tag of the partners, or null for all. */
	readonly tag: string | null;
	/** The contacts picked one by one, in the order they were picked. */
	readonly chosen: readonly Readonly<RecipientChoice>[];
}

/** Every member, before anything is chosen. */
const INITIAL_DRAFT: SelectionDraft = {
	chosen: [],
	group: null,
	kind: 'member',
	mode: 'filter',
	query: '',
	tag: null,
};

/**
 * The selection the server takes. A group filters members, a tag partners: a filter of the other
 * kind does not count. Picked contacts count alone, of both kinds.
 *
 * @param draft The step's state.
 * @returns The selection.
 */
function selectionOf(draft: SelectionDraft): RecipientSelection {
	if (draft.mode === 'single') {
		return { contactIds: draft.chosen.map(({ id }) => id), filters: {}, kind: 'both', query: '' };
	}
	const { group, kind, query, tag } = draft;
	return {
		contactIds: null,
		filters: {
			...(group === null || kind === 'partner' ? {} : { group }),
			...(tag === null || kind === 'member' ? {} : { tag }),
		},
		kind,
		query,
	};
}

/**
 * Adds a picked contact, unless it is picked already.
 *
 * @param chosen The picked contacts.
 * @param contact The contact.
 * @returns The picked contacts with it; the same list when it was in it.
 */
function addChosen(
	chosen: readonly Readonly<RecipientChoice>[],
	contact: Readonly<RecipientChoice>,
): readonly Readonly<RecipientChoice>[] {
	return chosen.some(({ id }) => id === contact.id) ? chosen : [...chosen, contact];
}

/**
 * Removes a picked contact.
 *
 * @param chosen The picked contacts.
 * @param id The contact.
 * @returns The picked contacts without it.
 */
function removeChosen(
	chosen: readonly Readonly<RecipientChoice>[],
	id: string,
): readonly Readonly<RecipientChoice>[] {
	return chosen.filter((contact) => contact.id !== id);
}

/** A selection as a server function takes it: its own, mutable copy of the picked ids. */
type SelectionRequest = Omit<RecipientSelection, 'contactIds'> & { contactIds: string[] | null };

/**
 * A selection as a server function takes it.
 *
 * @param selection The selection.
 * @returns A copy whose list of ids is its own.
 */
function selectionRequest(selection: RecipientSelection): SelectionRequest {
	const { contactIds } = selection;
	return { ...selection, contactIds: contactIds === null ? null : [...contactIds] };
}

export { addChosen, INITIAL_DRAFT, removeChosen, selectionOf, selectionRequest };
export type { SelectionDraft, SelectionMode, SelectionRequest };
