import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vite-plus/test';

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

	it('accepts messages only from the parent window and the app origin', () => {
		expect(page).toContain('event.source !== window.parent');
		expect(page).toContain('event.origin !== origin');
		expect(page).toContain('var origin = "https://verein.example"');
	});

	it('answers the parent at the app origin only', () => {
		expect(page).toContain('window.parent.postMessage({ type: "vb-preview-ready" }, origin)');
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
	send: Listener;
}

/**
 * Runs the frame's script against stand-ins for the browser objects.
 *
 * @param origin The app origin the page is made for.
 * @returns The stand-ins and a way to deliver messages.
 */
function runFrame(origin = 'https://verein.example'): FrameRun {
	const parent = { postMessage: vi.fn() };
	const listeners = new Map<string, Listener>();
	const clickListeners: { listener: Listener; capture: unknown }[] = [];
	const meta = { remove: vi.fn() };
	const parsed = {
		body: 'body',
		head: 'head',
		querySelectorAll: vi.fn(() => [meta]),
	};
	const documentElement = { replaceChildren: vi.fn() };
	const document = {
		addEventListener: (type: string, listener: Listener, capture: unknown) => {
			if (type === 'click') clickListeners.push({ capture, listener });
		},
		adoptNode: (node: unknown) => node,
		documentElement,
	};
	const window = {
		addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
		parent,
	};
	class FakeParser {
		public parseFromString = vi.fn(() => parsed);
	}
	const script = /<script nonce="n1">(?<code>[\s\S]*)<\/script>/u.exec(
		previewFramePage('n1', origin),
	)?.groups?.code;
	runInNewContext(script ?? '', { DOMParser: FakeParser, document, window });
	const send = (event: unknown): void => listeners.get('message')?.(event);
	return {
		click: (event) => clickListeners[0]?.listener(event),
		clickCaptures: clickListeners.map((entry) => entry.capture),
		documentElement,
		meta,
		parent,
		parsed,
		send,
	};
}

describe('the frame script', () => {
	const html = '<p>x</p>';
	const good = { data: { html, type: 'vb-preview' }, origin: 'https://verein.example' };

	it('tells the parent it is ready, at the app origin only', () => {
		const { parent } = runFrame();
		expect(parent.postMessage).toHaveBeenCalledWith(
			{ type: 'vb-preview-ready' },
			'https://verein.example',
		);
	});

	it('shows the mail of the parent window', () => {
		const frame = runFrame();
		frame.send({ ...good, source: frame.parent });
		expect(frame.documentElement.replaceChildren).toHaveBeenCalledWith('head', 'body');
	});

	it('ignores a foreign source, a wrong origin and a bad shape', () => {
		const frame = runFrame();
		frame.send({ ...good, source: {} });
		frame.send({ ...good, origin: 'https://evil.example', source: frame.parent });
		frame.send({
			data: { html: 5, type: 'vb-preview' },
			origin: good.origin,
			source: frame.parent,
		});
		frame.send({ data: { html, type: 'other' }, origin: good.origin, source: frame.parent });
		frame.send({ data: 'vb-preview', origin: good.origin, source: frame.parent });
		frame.send({ data: null, origin: good.origin, source: frame.parent });
		expect(frame.documentElement.replaceChildren).not.toHaveBeenCalled();
	});

	it('removes a meta refresh from the mail', () => {
		const frame = runFrame();
		frame.send({ ...good, source: frame.parent });
		expect(frame.parsed.querySelectorAll).toHaveBeenCalledWith('meta[http-equiv="refresh" i]');
		expect(frame.meta.remove).toHaveBeenCalledOnce();
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
