/*
 * The limits and presets of occasions that forms share. A module without imports, so that browser
 * code does not pull the database layer of `occasions.ts` into its chunk.
 */

/** The kinds of an occasion: one mail per contact (`personal`) or one per address (`circular`). */
type OccasionKind = 'circular' | 'personal';

/** The most characters of an occasion's name. */
const MAX_OCCASION_NAME_LENGTH = 100;

/**
 * Whether the unsubscribe link is on for a new occasion of this kind: circulars carry it,
 * personal occasions do not. The form lets the user change it.
 *
 * @param kind The kind.
 * @returns The preset.
 */
function defaultUnsubscribe(kind: OccasionKind): boolean {
	return kind === 'circular';
}

export { defaultUnsubscribe, MAX_OCCASION_NAME_LENGTH };
export type { OccasionKind };
