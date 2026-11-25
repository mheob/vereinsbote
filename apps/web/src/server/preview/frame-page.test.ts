import { runInNewContext } from 'node:vm';

import { describe, expect, it, onTestFinished, vi } from 'vite-plus/test';

import { previewFramePage } from './frame-page';

describe(previewFramePage, () => {
	const page = previewFramePage('n1', 'https://verein.example');

	it('has exactly one script, with the nonce of the request', () => {
		expect(page.match(/<script/gu)).toHaveLength(1);
		expect(page).toContain('<script nonce="n1">');
	});

	it('loads nothing from outside and has no inline style or handler', () => {
		expect(page).not.toMatch(/\ssrc=|<link|<style|\son\w+=/u);
	});

	it('takes the mail on a message channel of its own, never on the window', () => {
		expect(page).toContain('new MessageChannel()');
		expect(page).not.toContain('window.addEventListener');
		expect(page).not.toContain('"*"');
	});

	it('hands its port to the parent at the app origin only', () => {
		expect(page).toContain('var origin = "https://verein.example"');
		expect(page).toContain(
			'window.parent.postMessage({ type: "vb-preview-ready" }, origin, [channel.port2])',
		);
	});

	it('never evaluates strings', () => {
		expect(page).not.toMatch(/eval\(|new Function|setTimeout\(["']/u);
	});

	it('escapes an origin that would close the script', () => {
		const hostile = previewFramePage('n1', 'https://a.example</script><b>');
		expect(hostile.match(/<script/gu)).toHaveLength(1);
		expect(hostile).not.toContain('</script><b>');
	});

	it('has a language and an empty body for the first load', () => {
		expect(page).toMatch(/^<!doctype html>/iu);
		expect(page).toContain('<body></body>');
	});
});

type Listener = (event: unknown) => void;

interface FrameRun {
	click: Listener;
	clickCaptures: unknown[];
	documentElement: { replaceChildren: ReturnType<typeof vi.fn> };
	meta: { remove: ReturnType<typeof vi.fn> };
	parent: { postMessage: ReturnType<typeof vi.fn> };
	parsed: { querySelectorAll: ReturnType<typeof vi.fn> };
	parseFromString: ReturnType<typeof vi.fn>;
	port: MessagePort | undefined;
	windowListeners: string[];
}

/**
 * Runs the frame's script against stand-ins for the browser objects and a real message channel.
 * The parent's end of the channel is closed when the test ends.
 *
 * @param origin The app origin the page is made for.
 * @returns The stand-ins and the port the frame handed to the parent.
 */
function runFrame(origin = 'https://verein.example'): FrameRun {
	const parent = { postMessage: vi.fn() };
	const windowListeners: string[] = [];
	const clickListeners: { listener: Listener; capture: unknown }[] = [];
	const meta = { remove: vi.fn() };
	const parsed = {
		body: 'body',
		head: 'head',
		querySelectorAll: vi.fn(() => [meta]),
	};
	const parseFromString = vi.fn(() => parsed);
	const documentElement = { replaceChildren: vi.fn() };
	const document = {
		addEventListener: (type: string, listener: Listener, capture: unknown) => {
			if (type === 'click') clickListeners.push({ capture, listener });
		},
		adoptNode: (node: unknown) => node,
		documentElement,
	};
	const window = {
		addEventListener: (type: string) => windowListeners.push(type),
		parent,
	};
	class FakeParser {
		public parseFromString = parseFromString;
	}
	const script = /<script nonce="n1">(?<code>[\s\S]*)<\/script>/u.exec(
		previewFramePage('n1', origin),
	)?.groups?.code;
	runInNewContext(script ?? '', { DOMParser: FakeParser, MessageChannel, document, window });
	const transfer: unknown = parent.postMessage.mock.calls[0]?.[2];
	const port: unknown = Array.isArray(transfer) ? transfer[0] : undefined;
	const handed = port instanceof MessagePort ? port : undefined;
	onTestFinished(() => {
		handed?.close();
	});
	return {
		click: (event) => clickListeners[0]?.listener(event),
		clickCaptures: clickListeners.map((entry) => entry.capture),
		documentElement,
		meta,
		parent,
		parseFromString,
		parsed,
		port: handed,
		windowListeners,
	};
}

describe('the frame script', () => {
	const html = '<p>x</p>';
	const mail = { html, type: 'vb-preview' };

	it('tells the parent it is ready, at the app origin only, and hands over a port', () => {
		const { parent, port } = runFrame();
		expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith(
			{ type: 'vb-preview-ready' },
			'https://verein.example',
			[port],
		);
		expect(port).toBeInstanceOf(MessagePort);
	});

	it('shows the mail that arrives on the port', async () => {
		const frame = runFrame();
		frame.port?.postMessage(mail);
		await vi.waitFor(() => {
			expect(frame.documentElement.replaceChildren).toHaveBeenCalledWith('head', 'body');
		});
		expect(frame.parseFromString).toHaveBeenCalledWith(html, 'text/html');
	});

	it('ignores a bad shape on the port', async () => {
		const frame = runFrame();
		for (const data of [
			{ html: 5, type: 'vb-preview' },
			{ html, type: 'other' },
			'vb-preview',
			null,
		]) {
			frame.port?.postMessage(data);
		}
		// The port delivers in order: once the good message is shown, the bad ones were handled.
		frame.port?.postMessage(mail);
		await vi.waitFor(() => {
			expect(frame.documentElement.replaceChildren).toHaveBeenCalledOnce();
		});
		expect(frame.parseFromString).toHaveBeenCalledExactlyOnceWith(html, 'text/html');
	});

	it('takes no message on the window', () => {
		expect(runFrame().windowListeners).toStrictEqual([]);
	});

	it('removes a meta refresh from the mail', async () => {
		const frame = runFrame();
		frame.port?.postMessage(mail);
		await vi.waitFor(() => {
			expect(frame.meta.remove).toHaveBeenCalledOnce();
		});
		expect(frame.parsed.querySelectorAll).toHaveBeenCalledWith('meta[http-equiv="refresh" i]');
	});

	it('cancels a click on or inside a link, in the capture phase, and leaves other clicks', () => {
		const { click, clickCaptures } = runFrame();
		expect(clickCaptures).toStrictEqual([true]);
		const onLink = { preventDefault: vi.fn(), target: { closest: vi.fn(() => ({})) } };
		click(onLink);
		expect(onLink.target.closest).toHaveBeenCalledWith('a[href], area[href]');
		expect(onLink.preventDefault).toHaveBeenCalledOnce();
		const elsewhere = { preventDefault: vi.fn(), target: { closest: vi.fn(() => null) } };
		click(elsewhere);
		expect(elsewhere.preventDefault).not.toHaveBeenCalled();
	});
});
