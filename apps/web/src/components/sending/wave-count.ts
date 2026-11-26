/*
 * The count of the wave the send flow would make (Design 10.1, 10.5): asked again after each
 * change of the selection (after a pause in typing) or of the files, and when the flow asks for a
 * recount. An answer counts only for its own request.
 */
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';

import { FAILED, settle } from '@/components/settle';
import { summarizeWave } from '@/functions/waves';
import type { WaveFailure } from '@/server/waves/failures';

import { selectionRequest } from './selection';
import { summaryStateOf } from './summary-state';
import type { CountRequest, SummaryAnswer, SummaryState } from './summary-state';

/**
 * Counts the wave of a request.
 *
 * @param occasionId The occasion.
 * @param request The selection, the files and the recount.
 * @param onFailure Called with a failure of the flow (the occasion gone or archived, a file gone).
 * @returns The numbers.
 */
function useWaveCount(
	occasionId: string,
	request: CountRequest,
	onFailure: (failure: WaveFailure['failure']) => void,
): SummaryState {
	const summarize = useServerFn(summarizeWave);
	const [answer, setAnswer] = useState<SummaryAnswer | null>(null);
	useEffect(() => {
		let current = true;
		async function run(): Promise<void> {
			const data = {
				attachmentIds: [...request.attachmentIds],
				occasionId,
				selection: selectionRequest(request.selection),
			};
			const result = await settle(summarize({ data }));
			if (!current || result === undefined) return;
			if (result !== FAILED && result.ok) {
				setAnswer({ request, state: { status: 'ready', summary: result.summary } });
				return;
			}
			setAnswer({ request, state: { status: 'failed' } });
			if (result !== FAILED) onFailure(result.failure);
		}
		// oxlint-disable-next-line no-void -- `run` never rejects: `settle` catches a failed call
		void run();
		return () => {
			current = false;
		};
	}, [occasionId, onFailure, request, summarize]);
	return summaryStateOf(request, answer);
}

export { useWaveCount };
