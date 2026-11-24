/** At most one login link per address and window; requests inside an open window send nothing. */
const LOGIN_LINK_WINDOW_SECONDS = 60;

/** Login link requests per client address and window, enforced by Better Auth's rate limiter. */
const LINK_REQUESTS_PER_WINDOW = 5;
const LINK_REQUEST_WINDOW_SECONDS = 60;

/**
 * The longest window of Better Auth's rate limiter in this app: the link requests above and
 * Better Auth's own rules (10 and 60 seconds). A counter idle for longer starts over anyway.
 */
const LONGEST_RATE_LIMIT_WINDOW_SECONDS = 60;

export {
	LINK_REQUEST_WINDOW_SECONDS,
	LINK_REQUESTS_PER_WINDOW,
	LOGIN_LINK_WINDOW_SECONDS,
	LONGEST_RATE_LIMIT_WINDOW_SECONDS,
};
