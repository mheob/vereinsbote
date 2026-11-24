import { createMiddleware } from '@tanstack/react-start';

/*
 * TanStack Start reads the whole body of a server function call with form data
 * (`request.formData()`) before the function runs. Only the import sends form data; its payload
 * is at most `MAX_COMPRESSED_PAYLOAD_BYTES`. Vercel refuses larger requests itself (4.5 MB), the
 * Node server does not, so this cap keeps a large body from filling its memory.
 */

/** The import payload, its few text fields and the multipart framing, at most Vercel's 4.5 MB. */
const MAX_FORM_BODY_BYTES = 4_500_000;

/** The content types Start reads with `request.formData()`. */
const FORM_CONTENT_TYPES = ['multipart/form-data', 'application/x-www-form-urlencoded'];

const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;

/**
 * Tells whether a declared body length is above a limit.
 *
 * @param declared The `Content-Length`, or null without one.
 * @param limit The most bytes.
 * @returns True when the length is above the limit or not a number.
 */
function declaredAbove(declared: string | null, limit: number): boolean {
	return declared !== null && !(/^\d+$/u.test(declared) && Number(declared) <= limit);
}

/** A body within the limit, above it, or one that broke off while it was counted. */
type BodySize = 'tooLarge' | 'unreadable' | 'within';

/**
 * Reads a stream until it ends or has more bytes than a limit; the lock is released then.
 *
 * @param body The stream.
 * @param limit The most bytes.
 * @returns True as soon as the stream has more bytes than the limit.
 * @throws {Error} When the stream breaks off.
 */
async function readsPast(body: ReadableStream<Uint8Array>, limit: number): Promise<boolean> {
	const reader = body.getReader();
	let bytes = 0;
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- a stream is read one chunk after the other
		const { done, value } = await reader.read();
		if (done) return false;
		bytes += value.byteLength;
		if (bytes > limit) {
			reader.releaseLock();
			return true;
		}
	}
}

/**
 * Counts the bytes of a copy of a body up to a limit. Above it both the copy and the original are
 * cancelled: a tee cancels its source only when both branches are, and the original would hold
 * what was read so far until the connection ends.
 *
 * @param copy The copy of the body, from `request.clone()`.
 * @param original The body of the request itself.
 * @param limit The most bytes.
 * @returns How large the body is; `unreadable` when it broke off.
 */
async function countBody(
	copy: ReadableStream<Uint8Array>,
	original: ReadableStream<Uint8Array> | null,
	limit: number,
): Promise<BodySize> {
	try {
		if (!(await readsPast(copy, limit))) return 'within';
	} catch {
		// The client went away or sent a malformed body; the copy broke off with the original.
		return 'unreadable';
	}
	await Promise.all([copy.cancel(), original?.cancel()]);
	return 'tooLarge';
}

/**
 * Checks the size of a request body: its declared length, then the count of a copy of the
 * body. A body within the limit stays unread for the handler.
 *
 * @param request The request.
 * @param limit The most bytes.
 * @returns `tooLarge` when the declared length is above the limit or not a number, or the body
 *   is; `unreadable` when the body broke off; `within` otherwise.
 */
async function checkBodySize(request: Request, limit: number): Promise<BodySize> {
	if (declaredAbove(request.headers.get('content-length'), limit)) return 'tooLarge';
	const copy = request.clone().body;
	return copy === null ? 'within' : countBody(copy, request.body, limit);
}

/**
 * A plain answer of the middleware.
 *
 * @param text The text.
 * @param status The status.
 * @returns The response.
 */
function textResponse(text: string, status: number): Response {
	return new Response(text, { headers: { 'content-type': 'text/plain' }, status });
}

/**
 * Answers 413 to a server function call with form data above `MAX_FORM_BODY_BYTES`, before Start
 * reads the body, and 400 to a body that breaks off while it is counted. Other requests pass
 * unread.
 */
const formBodyLimit = createMiddleware({ type: 'request' }).server(
	async ({ handlerType, next, request }) => {
		const contentType = request.headers.get('content-type') ?? '';
		const isForm = FORM_CONTENT_TYPES.some((type) => contentType.includes(type));
		if (handlerType !== 'serverFn' || !isForm) return next();
		const size = await checkBodySize(request, MAX_FORM_BODY_BYTES);
		if (size === 'within') return next();
		// A response, never an error: Start would send an error's message to the browser.
		return size === 'tooLarge'
			? textResponse('Payload Too Large', HTTP_PAYLOAD_TOO_LARGE)
			: textResponse('Bad Request', HTTP_BAD_REQUEST);
	},
);

export { checkBodySize, formBodyLimit, MAX_FORM_BODY_BYTES };
export type { BodySize };
