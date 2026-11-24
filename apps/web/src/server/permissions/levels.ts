/**
 * The access levels, lowest first; each level includes the ones below it. The schema and the
 * level selects use this list, so it is the only place a level is defined. No imports, so the
 * client bundle can use it.
 */
const accessLevels = ['read', 'edit', 'send'] as const;

type AccessLevel = (typeof accessLevels)[number];

/**
 * Tells whether a level includes another one. Levels are cumulative: `send` includes `edit`,
 * which includes `read`.
 *
 * @param have The level the user holds, or null for none.
 * @param need The level the action requires.
 * @returns True when `have` is at least `need`.
 */
function levelAtLeast(have: AccessLevel | null, need: AccessLevel): boolean {
	return have !== null && accessLevels.indexOf(have) >= accessLevels.indexOf(need);
}

export { accessLevels, levelAtLeast };
export type { AccessLevel };
