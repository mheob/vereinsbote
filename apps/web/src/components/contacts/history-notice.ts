/*
 * Notices a page leaves for the page it navigates to: in the state of the new history entry,
 * never in the URL (design 13), e.g. the name of a deleted partner for the contact list or of a
 * copied template for its page. The keys are declared on the router's `HistoryState` (`router.tsx`).
 */

/** A notice in the history state. */
type HistoryNoticeKey = 'deletedContact' | 'partnerSaved' | 'templateNotice';

/** The part of `window.history` a notice needs. */
interface NoticeHistory {
	readonly state: unknown;
	readonly replaceState: (state: unknown, unused: string) => void;
}

/**
 * Removes a notice from the current history entry once it was shown, so a reload or a return
 * to the entry does not show it again. The router's own keys of the entry stay.
 *
 * @param history The browser's history.
 * @param key The notice.
 */
function clearHistoryNotice(history: NoticeHistory, key: HistoryNoticeKey): void {
	const { state } = history;
	if (typeof state !== 'object' || state === null || !Object.hasOwn(state, key)) return;
	const kept = Object.fromEntries(Object.entries(state).filter(([name]) => name !== key));
	history.replaceState(kept, '');
}

export { clearHistoryNotice };
export type { HistoryNoticeKey };
