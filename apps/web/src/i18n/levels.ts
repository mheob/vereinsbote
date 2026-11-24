import { accessLevels } from '@/server/permissions/levels';
import type { AccessLevel } from '@/server/permissions/levels';

import type { MessageKey } from './translate';

/** The access levels, lowest first, in the order the level selects offer them (the schema's). */
const ACCESS_LEVELS = accessLevels;

/** No access: the option of a level select that removes the user's level. */
const NO_ACCESS = 'none';

type LevelChoice = AccessLevel | typeof NO_ACCESS;

/** The text of each level and of no access. */
const LEVEL_MESSAGES: Readonly<Record<LevelChoice, MessageKey>> = {
	edit: 'level.edit',
	none: 'level.none',
	read: 'level.read',
	send: 'level.send',
};

export { ACCESS_LEVELS, LEVEL_MESSAGES, NO_ACCESS };
export type { LevelChoice };
