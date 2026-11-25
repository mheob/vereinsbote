import { describe, expect, it, onTestFinished, vi } from 'vite-plus/test';

import {
	PREVIEW_MESSAGE,
	PREVIEW_READY,
	previewReadyListener,
	SANDBOXED_ORIGIN,
} from './preview-protocol';

/** Stand-ins for windows: the protocol compares them by identity only. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- there is no window outside a browser
const windows = [{ name: 'frame' }, { name: 'other' }] as unknown as readonly [Window, Window];
const [frame, other] = windows;

/** What the listener calls with the port. */
type OnPort = Parameters<typeof previewReadyListener>[1];

/**
 * A port of a real channel, closed when the test ends.
 *
 * @returns The port.
 */
function openPort(): MessagePort {
	const channel = new MessageChannel();
	onTestFinished(() => {
		channel.port1.close();
	});
	return channel.port1;
}

/**
 * The listener for a frame, and what it handed on.
 *
 * @param current The window of the frame, or null while there is none.
 * @returns The listener and the callback that receives the ports.
 */
function listen(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a window is a browser handle
	current: Window | null = frame,
): {
	listener: ReturnType<typeof previewReadyListener>;
	onPort: ReturnType<typeof vi.fn<OnPort>>;
} {
	const onPort = vi.fn<OnPort>();
	return { listener: previewReadyListener(() => current, onPort), onPort };
}

describe(previewReadyListener, () => {
	it('names the two message types and the origin of a sandboxed frame', () => {
		expect(PREVIEW_MESSAGE).toBe('vb-preview');
		expect(PREVIEW_READY).toBe('vb-preview-ready');
		expect(SANDBOXED_ORIGIN).toBe('null');
	});

	it('hands on the port of the frame’s ready message', () => {
		const port = openPort();
		const { listener, onPort } = listen();
		listener({ data: { type: PREVIEW_READY }, origin: 'null', ports: [port], source: frame });
		expect(onPort).toHaveBeenCalledExactlyOnceWith(port);
	});

	it('refuses another window', () => {
		const port = openPort();
		const { listener, onPort } = listen();
		listener({ data: { type: PREVIEW_READY }, origin: 'null', ports: [port], source: other });
		listener({ data: { type: PREVIEW_READY }, origin: 'null', ports: [port], source: null });
		expect(onPort).not.toHaveBeenCalled();
	});

	it('refuses an origin that is not opaque', () => {
		const port = openPort();
		const { listener, onPort } = listen();
		for (const origin of ['https://verein.example', '', 'NULL']) {
			listener({ data: { type: PREVIEW_READY }, origin, ports: [port], source: frame });
		}
		expect(onPort).not.toHaveBeenCalled();
	});

	it('refuses everything while there is no frame', () => {
		const port = openPort();
		const { listener, onPort } = listen(null);
		listener({ data: { type: PREVIEW_READY }, origin: 'null', ports: [port], source: null });
		expect(onPort).not.toHaveBeenCalled();
	});

	it('refuses other messages', () => {
		const port = openPort();
		const { listener, onPort } = listen();
		for (const data of [{ type: 'x' }, PREVIEW_READY, null, undefined]) {
			listener({ data, origin: 'null', ports: [port], source: frame });
		}
		expect(onPort).not.toHaveBeenCalled();
	});

	it('refuses a ready message without a port', () => {
		const { listener, onPort } = listen();
		listener({ data: { type: PREVIEW_READY }, origin: 'null', ports: [], source: frame });
		expect(onPort).not.toHaveBeenCalled();
	});
});
