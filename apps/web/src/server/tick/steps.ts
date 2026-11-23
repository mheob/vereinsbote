import { pruneAuthRecords } from '@/server/auth/prune';

import type { TickStep } from './tick';

/** The steps of every tick, in order. Later plans add theirs here. */
const tickSteps: readonly TickStep[] = [pruneAuthRecords];

export { tickSteps };
