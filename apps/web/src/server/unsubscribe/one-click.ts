/*
 * The one-click unsubscribe of RFC 8058 (Design 12): a mail provider posts the field
 * `List-Unsubscribe=One-Click` to the link of the `List-Unsubscribe` header, server to server,
 * without cookies and without `Origin`, as `multipart/form-data` (which the RFC prefers) or as
 * `application/x-www-form-urlencoded`. The route answers it itself, outside the CSRF check of the
 * server functions (Design 17); the token is its protection. No session is read or made.
 *
 * The request is checked before anything else, the token before any database work, so a flood of
 * made-up links costs no query. Every answer is empty: 400 for a request of another form, 404 for
 * a token that does not open, 200 once the contacts of the mail have their opt-out of the occasion,
 * and 500 when that fails (logged by its label only, never with the token).
 */

import { TEST_UNSUBSCRIBE_TOKEN } from '@/paths';
import { checkBodySize } from '@/platform/body-limit';
import type { Db } from '@/server/db/client';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';

import { deriveUnsubscribeKey, openUnsubscribe } from './token';
import type { UnsubscribePayload } from './token';
import { deriveUndoKey } from './undo';
import { unsubscribe, UnsubscribeTargetGoneError } from './unsubscribe';

/** What the one-click unsubscribe needs; the database is opened only for a token that opened. */
interface OneClickServices {
	/** The environment, for the app secret; it opens no database. */
	readonly env: () => Promise<Env>;
	readonly db: () => Promise<Db>;
	readonly now: () => Date;
}

/** RFC 8058's field is 26 bytes, a few more with multipart framing; a longer body is no one-click. */
const MAX_BODY_BYTES = 1024;
/** The form types of RFC 8058: multipart (preferred) and URL-encoded. */
const FORM_TYPES: ReadonlySet<string> = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
]);
const ONE_CLICK_FIELD = 'List-Unsubscribe';
const ONE_CLICK_VALUE = 'One-Click';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

/**
 * An empty answer.
 *
 * @param status The status.
 * @returns The response.
 */
function empty(status: number): Response {
	return new Response(null, { status });
}

/**
 * Reads the form of a request: multipart or URL-encoded, of at most `MAX_BODY_BYTES`. The body is
 * parsed only once its size is known to be within the bound.
 *
 * @param request The request.
 * @returns The form, or null for another type, a larger body or one that does not parse.
 */
async function readForm(request: Request): Promise<FormData | null> {
	const contentType = request.headers.get('content-type') ?? '';
	const [type = ''] = contentType.split(';');
	if (!FORM_TYPES.has(type.trim().toLowerCase())) return null;
	if ((await checkBodySize(request, MAX_BODY_BYTES)) !== 'within') return null;
	const bytes = await request.arrayBuffer();
	try {
		// The request's own type, with the boundary of a multipart body.
		return await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
	} catch {
		return null;
	}
}

/**
 * Whether a request is RFC 8058's one-click POST: a form with exactly its one field,
 * `List-Unsubscribe` with the value `One-Click` (text, not a file).
 *
 * @param request The request.
 * @returns True for a one-click request.
 */
async function isOneClickRequest(request: Request): Promise<boolean> {
	const form = await readForm(request);
	if (form === null) return false;
	const [first, ...others] = form.entries();
	return others.length === 0 && first?.[0] === ONE_CLICK_FIELD && first[1] === ONE_CLICK_VALUE;
}

/**
 * Opts the contacts of a mail out of its occasion. An occasion that is gone sends no more mail,
 * so there is nothing left to do.
 *
 * @param services The services.
 * @param payload The opened token.
 */
async function optOutOfOccasion(
	services: Readonly<OneClickServices>,
	payload: UnsubscribePayload,
): Promise<void> {
	const [db, env] = await Promise.all([services.db(), services.env()]);
	try {
		await unsubscribe(db, await deriveUndoKey(env.appSecret), payload, 'occasion', services.now());
	} catch (error) {
		if (!(error instanceof UnsubscribeTargetGoneError)) throw error;
	}
}

/**
 * Answers a one-click POST to an unsubscribe link.
 *
 * @param request The request.
 * @param token The token of the link.
 * @param services The environment, the database and the clock.
 * @returns An empty response: 200, 400, 404 or 500.
 */
async function handleOneClick(
	request: Request,
	token: string,
	services: Readonly<OneClickServices>,
): Promise<Response> {
	if (!(await isOneClickRequest(request))) return empty(HTTP_BAD_REQUEST);
	// The link of a test mail or a preview: it changes nothing.
	if (token === TEST_UNSUBSCRIBE_TOKEN) return empty(HTTP_OK);
	try {
		const { appSecret } = await services.env();
		const payload = await openUnsubscribe(await deriveUnsubscribeKey(appSecret), token);
		if (payload === null) return empty(HTTP_NOT_FOUND);
		await optOutOfOccasion(services, payload);
		return empty(HTTP_OK);
	} catch (error) {
		// oxlint-disable-next-line no-console -- the label only: the message may name the token
		console.error('one-click unsubscribe failed', errorLabel(error));
		return empty(HTTP_SERVER_ERROR);
	}
}

export { handleOneClick };
export type { OneClickServices };
