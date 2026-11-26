import { attachmentCleanup } from '@/server/attachments/cleanup';
import { pruneAuthRecords } from '@/server/auth/prune';
import { staleImportWarning } from '@/server/contacts/stale-import';
import { createOutboxStep } from '@/server/sending/outbox-step';
import { sendingWarnings } from '@/server/sending/warnings';

import type { TickStep } from './tick';

/** Sends the due mails of the outbox. Sub-plan 4b adds the preparer of waves. */
const outbox = createOutboxStep({
	fetch: async (input, init) => fetch(input, init),
	preparers: {},
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
	attachmentCleanup,
	staleImportWarning,
	sendingWarnings,
];

export { tickSteps };
