/*
 * What the parent window and the preview frame say to each other (Plan 3, decision 6). The frame
 * (`server/preview/frame-page.ts`) opens a `MessageChannel` on load and posts the ready message
 * with one port to the parent window, at the app's origin only. The parent takes that message only
 * from the frame's window and from the frame's opaque origin, keeps the port and sends the mail's
 * HTML on it. No message goes to the target origin `*`.
 */

/** Parent to frame, on the port: `{ type, html }`, the mail's HTML to show. */
const PREVIEW_MESSAGE = 'vb-preview';
/** Frame to parent, on the window, with the port as transfer: `{ type }`, the frame can take a mail. */
const PREVIEW_READY = 'vb-preview-ready';

/**
 * The origin of the frame's messages. The frame is sandboxed without `allow-same-origin`, so its
 * origin is opaque, and a message event names an opaque origin by its serialization, the string
 * `'null'` (HTML Standard, "serialization of an origin"). A page at any real origin, the app's own
 * included, sends with another one.
 */
const SANDBOXED_ORIGIN = 'null';

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a message event is a browser object
type ReadyListener = (event: Pick<MessageEvent, 'data' | 'origin' | 'ports' | 'source'>) => void;

/**
 * Whether message data is the ready message.
 *
 * @param data The data of a message.
 * @returns True for `{ type: 'vb-preview-ready' }`.
 */
function isReadyData(data: unknown): boolean {
	return typeof data === 'object' && data !== null && 'type' in data && data.type === PREVIEW_READY;
}

/**
 * The listener for the window's messages that takes the frame's ready message and hands its port
 * on. It takes the message only from the frame's window, from the opaque origin of the sandboxed
 * frame, with the ready message's data and a port; everything else is ignored.
 *
 * @param frame The window of the preview frame, or null while there is none.
 * @param onPort Called with the port the frame handed over.
 * @returns The listener.
 */
function previewReadyListener(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a window is a browser handle
	frame: () => Window | null,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a port is a browser handle
	onPort: (port: MessagePort) => void,
): ReadyListener {
	return (event) => {
		const current = frame();
		if (current === null || event.source !== current || event.origin !== SANDBOXED_ORIGIN) return;
		const [port] = event.ports;
		if (port !== undefined && isReadyData(event.data)) onPort(port);
	};
}

export { PREVIEW_MESSAGE, PREVIEW_READY, previewReadyListener, SANDBOXED_ORIGIN };
