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

/**
 * Counts the bytes of a stream up to a limit.
 *
 * @param body The stream.
 * @param limit The most bytes.
 * @returns True as soon as the stream has more bytes than the limit.
 */
async function streamAbove(body: ReadableStream<Uint8Array>, limit: number): Promise<boolean> {
	const reader = body.getReader();
	let bytes = 0;
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- a stream is read one chunk after the other
		const { done, value } = await reader.read();
		if (done) return false;
		bytes += value.byteLength;
		if (bytes > limit) {
			// Not cancelled: cancelling a copy waits for the original, which nobody reads any more.
			// The reading stops here, and the request ends with the response.
			reader.releaseLock();
			return true;
		}
	}
}

/**
 * Tells whether a request body is larger than a limit: by its declared length, then by counting
 * a copy of the body. A body within the limit stays unread for the handler.
 *
 * @param request The request.
 * @param limit The most bytes.
 * @returns True when the declared length is above the limit or not a number, or the body is.
 */
async function exceedsBodyLimit(request: Request, limit: number): Promise<boolean> {
	if (declaredAbove(request.headers.get('content-length'), limit)) return true;
	const copy = request.clone().body;
	return copy === null ? false : streamAbove(copy, limit);
}

/**
 * Answers 413 to a server function call with form data above `MAX_FORM_BODY_BYTES`, before Start
 * reads the body. Other requests pass unread.
 */
const formBodyLimit = createMiddleware({ type: 'request' }).server(
	async ({ handlerType, next, request }) => {
		const contentType = request.headers.get('content-type') ?? '';
		const isForm = FORM_CONTENT_TYPES.some((type) => contentType.includes(type));
		if (handlerType !== 'serverFn' || !isForm) return next();
		if (await exceedsBodyLimit(request, MAX_FORM_BODY_BYTES)) {
			// A response, not an error: Start would send an error's message to the browser.
			return new Response('Payload Too Large', {
				headers: { 'content-type': 'text/plain' },
				status: HTTP_PAYLOAD_TOO_LARGE,
			});
		}
		return next();
	},
);

export { exceedsBodyLimit, formBodyLimit, MAX_FORM_BODY_BYTES };
