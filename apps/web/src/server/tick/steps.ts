import { attachmentCleanup } from '@/server/attachments/cleanup';
import { pruneAuthRecords } from '@/server/auth/prune';
import { graphBounces } from '@/server/bounces/graph-step';
import { staleImportWarning } from '@/server/contacts/stale-import';
import { createOutboxStep } from '@/server/sending/outbox-step';
import { sendingWarnings } from '@/server/sending/warnings';
import { wavePreparer } from '@/server/waves/preparer';

import type { TickStep } from './tick';

/** Sends the due mails of the outbox; the wave preparer builds each mail of a wave. */
const outbox = createOutboxStep({
	fetch: async (input, init) => fetch(input, init),
	preparers: { wave: wavePreparer },
	sleep: async (ms) =>
		// oxlint-disable-next-line promise/avoid-new -- `setTimeout` takes a callback; Node's timer promises are not on every platform
		new Promise((resolve) => {
			setTimeout(resolve, ms);
		}),
});

/**
 * The steps of every tick, in order (plan decision 20: sending, bounces, deletions, warnings;
 * the sending warnings come last). Later tasks add theirs at their place.
 */
const tickSteps: readonly TickStep[] = [
	pruneAuthRecords,
	outbox,
	graphBounces,
	attachmentCleanup,
	staleImportWarning,
	sendingWarnings,
];

/** The steps of a short run right after a wave is confirmed ("sofort", `kickRun`): the outbox only. */
const kickSteps: readonly TickStep[] = [outbox];

export { kickSteps, tickSteps };
