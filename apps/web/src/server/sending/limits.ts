/*
 * The limits of the connection and sender forms. A module without imports, so that browser code
 * (the forms' `maxLength`) does not pull the server modules into its chunk.
 */

/** The longest name of a connection and display name of a sender. */
const MAX_NAME_LENGTH = 100;
/** The longest tenant id, client id, secret or API key. */
const MAX_CREDENTIAL_LENGTH = 1000;
/** The longest e-mail address (RFC 5321). */
const MAX_ADDRESS_LENGTH = 254;
/** The most mails per minute a limit may allow. */
const MAX_PER_MINUTE = 10_000;
/** The most mails per day a limit may allow. */
const MAX_DAILY_LIMIT = 1_000_000;
/** What a Graph sender may send per minute until an admin sets a limit (Spec 6.6). */
const DEFAULT_GRAPH_PER_MINUTE = 30;
/**
 * What a Resend account may send per minute until an admin sets a limit: the default API rate
 * limit of Resend is 10 requests per second per team, one mail per request, so 600 per minute
 * (https://resend.com/docs/api-reference/introduction, checked on 2026-11-25).
 */
const DEFAULT_RESEND_PER_MINUTE = 600;

export {
	DEFAULT_GRAPH_PER_MINUTE,
	DEFAULT_RESEND_PER_MINUTE,
	MAX_ADDRESS_LENGTH,
	MAX_CREDENTIAL_LENGTH,
	MAX_DAILY_LIMIT,
	MAX_NAME_LENGTH,
	MAX_PER_MINUTE,
};
