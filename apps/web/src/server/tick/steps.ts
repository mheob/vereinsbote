import { pruneAuthRecords } from '@/server/auth/prune';
import { staleImportWarning } from '@/server/contacts/stale-import';

import type { TickStep } from './tick';

/** The steps of every tick, in order. Later plans add theirs here. */
const tickSteps: readonly TickStep[] = [pruneAuthRecords, staleImportWarning];

export { tickSteps };
