/*
 * What the send flow knows about the summary of its wave: being counted, counted, or the count
 * failed. Pure, so the rule that an answer counts only for its own request is tested without
 * React.
 */
import type { RecipientSelection } from '@/server/waves/recipients';
import type { WaveSummary } from '@/server/waves/waves';

/** The summary as the flow shows it. */
type SummaryState =
	| Readonly<{ status: 'counting' }>
	| Readonly<{ status: 'failed' }>
	| Readonly<{ status: 'ready'; summary: WaveSummary }>;

/** What a count asks: a new object for every change, and for every recount. */
interface CountRequest {
	readonly attachmentIds: readonly string[];
	readonly selection: RecipientSelection;
	readonly recount: number;
}

/** The last answer of the server, with the request it answered. */
interface SummaryAnswer {
	readonly request: CountRequest;
	readonly state: Exclude<SummaryState, { status: 'counting' }>;
}

const COUNTING: SummaryState = { status: 'counting' };

/**
 * The state for the current request.
 *
 * @param request The current request; a new object for every change.
 * @param answer The last answer, for whichever request, or null.
 * @returns `counting` until the answer to this request is in, then the summary or the failure.
 */
function summaryStateOf(request: CountRequest, answer: SummaryAnswer | null): SummaryState {
	return answer?.request === request ? answer.state : COUNTING;
}

export { COUNTING, summaryStateOf };
export type { CountRequest, SummaryAnswer, SummaryState };
