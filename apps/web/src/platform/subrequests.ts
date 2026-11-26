/*
 * The subrequests of one Cloudflare Worker invocation (Design 8.2). Workers Paid allows 10,000
 * subrequests per invocation by default (Cloudflare changelog of 2026-02-11 and "Workers limits";
 * before that it was 1,000). A `fetch` beyond the limit throws `Error: Too many subrequests.`
 * before anything leaves the Worker.
 *
 * The outbox and the Graph bounce check spend at most `CLOUDFLARE_PROVIDER_REQUESTS` of them
 * together on the providers per invocation: across all senders and all ticks a cron event chains
 * (`runScheduledTicks`), and in the request of `/api/tick`. That leaves most of the limit to the
 * database, the storage, the system and warning mails and the heartbeat. Node and Vercel have no
 * such limit and get no budget.
 */
import type { PlatformName } from './platform';

/**
 * Provider requests (Graph, Resend) the outbox and the Graph bounce check make together in one
 * Worker invocation: a tenth of the 10,000 subrequests of Workers Paid, so that even the old limit
 * of 1,000 would hold them alone. A Graph mail costs one request, and one more for the token of a
 * sender's run; the bounce check costs two per Graph sender (token and inbox).
 */
const CLOUDFLARE_PROVIDER_REQUESTS = 1000;

/** The code of a request the platform refused to make; nothing was sent. */
const SUBREQUEST_LIMIT_CODE = 'platform.subrequests';

/** The message of Workers (and older wordings of it) when the limit is reached. */
const LIMIT_MESSAGE = /too many subrequests|subrequest count exceeded/iu;

/** The requests one invocation may still make. */
interface SubrequestBudget {
	/** How many requests are left. */
	readonly left: () => number;
	/** Takes one request; false when none is left. */
	readonly take: () => boolean;
}

/** The budget of the invocation is spent: the request was not made. */
class SubrequestLimitError extends Error {
	public constructor() {
		super('Too many subrequests.');
		this.name = 'SubrequestLimitError';
	}
}

/**
 * A budget of requests.
 *
 * @param limit How many requests it allows.
 * @returns The budget.
 */
function createSubrequestBudget(limit: number): SubrequestBudget {
	let left = Math.max(0, limit);
	return {
		left: () => left,
		take() {
			if (left <= 0) return false;
			left -= 1;
			return true;
		},
	};
}

/**
 * The budget of one invocation on a platform.
 *
 * @param platform The platform.
 * @returns A fresh budget on Cloudflare, null (no limit) elsewhere.
 */
function invocationBudget(platform: PlatformName): SubrequestBudget | null {
	return platform === 'cloudflare' ? createSubrequestBudget(CLOUDFLARE_PROVIDER_REQUESTS) : null;
}

/**
 * A `fetch` that takes every request from a budget and throws `SubrequestLimitError` instead of
 * making one when the budget is spent.
 *
 * @param fetchFn The `fetch` that makes the requests.
 * @param budget The budget, or null for none.
 * @returns The `fetch`.
 */
function budgetedFetch(fetchFn: typeof fetch, budget: SubrequestBudget | null): typeof fetch {
	if (budget === null) return fetchFn;
	return async (input, init) => {
		if (!budget.take()) throw new SubrequestLimitError();
		return fetchFn(input, init);
	};
}

/**
 * Whether an error of `fetch` means that the request never left: the budget of the invocation
 * or the platform's own limit of subrequests.
 *
 * @param error Whatever `fetch` threw.
 * @returns True when nothing was sent.
 */
function isSubrequestLimit(error: unknown): boolean {
	if (error instanceof SubrequestLimitError) return true;
	return error instanceof Error && LIMIT_MESSAGE.test(error.message);
}

export {
	CLOUDFLARE_PROVIDER_REQUESTS,
	SUBREQUEST_LIMIT_CODE,
	SubrequestLimitError,
	budgetedFetch,
	createSubrequestBudget,
	invocationBudget,
	isSubrequestLimit,
};
export type { SubrequestBudget };
