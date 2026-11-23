import type { accessLevels } from '@/server/db/schema/areas';

type AccessLevel = (typeof accessLevels)[number];

const rank: Readonly<Record<AccessLevel, number>> = { edit: 1, read: 0, send: 2 };

/**
 * Tells whether a level includes another one. Levels are cumulative: `send` includes `edit`,
 * which includes `read`.
 *
 * @param have The level the user holds, or null for none.
 * @param need The level the action requires.
 * @returns True when `have` is at least `need`.
 */
function levelAtLeast(have: AccessLevel | null, need: AccessLevel): boolean {
	return have !== null && rank[have] >= rank[need];
}

export { levelAtLeast };
export type { AccessLevel };
