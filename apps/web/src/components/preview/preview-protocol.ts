/*
 * What the parent window and the preview frame say to each other (Plan 3, decision 6). The frame
 * (`server/preview/frame-page.ts`) is sandboxed without `allow-same-origin`, so its origin is
 * opaque: the parent finds the frame by its window, not by an origin.
 */

/** Parent to frame: `{ type, html }`, the mail's HTML to show. */
const PREVIEW_MESSAGE = 'vb-preview';
/** Frame to parent: `{ type }`, the frame can take a mail. */
const PREVIEW_READY = 'vb-preview-ready';

/**
 * Whether a message is the ready message of the frame, and from nobody else.
 *
 * @param event The message: its data and the window it came from.
 * @param frame The window of the preview frame, or null while there is none.
 * @returns True for the ready message of exactly that frame.
 */
function isPreviewReady(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a message event is a browser object
	event: Pick<MessageEvent, 'data' | 'source'>,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a window is a browser handle
	frame: Window | null,
): boolean {
	if (frame === null || event.source !== frame) return false;
	const data: unknown = event.data;
	return typeof data === 'object' && data !== null && 'type' in data && data.type === PREVIEW_READY;
}

export { isPreviewReady, PREVIEW_MESSAGE, PREVIEW_READY };
