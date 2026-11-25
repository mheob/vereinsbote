import { describe, expect, it } from 'vite-plus/test';

import { isPreviewReady, PREVIEW_MESSAGE, PREVIEW_READY } from './preview-protocol';

/** Stand-ins for windows: the protocol compares them by identity only. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- there is no window outside a browser
const windows = [{ name: 'frame' }, { name: 'other' }] as unknown as readonly [Window, Window];
const [frame, other] = windows;

describe(isPreviewReady, () => {
	it('names the two message types', () => {
		expect(PREVIEW_MESSAGE).toBe('vb-preview');
		expect(PREVIEW_READY).toBe('vb-preview-ready');
	});

	it('accepts the ready message of the frame', () => {
		expect(isPreviewReady({ data: { type: PREVIEW_READY }, source: frame }, frame)).toBe(true);
	});

	it('refuses another window', () => {
		expect(isPreviewReady({ data: { type: PREVIEW_READY }, source: other }, frame)).toBe(false);
		expect(isPreviewReady({ data: { type: PREVIEW_READY }, source: null }, frame)).toBe(false);
	});

	it('refuses everything while there is no frame', () => {
		expect(isPreviewReady({ data: { type: PREVIEW_READY }, source: null }, null)).toBe(false);
	});

	it('refuses other messages', () => {
		expect(isPreviewReady({ data: { type: 'x' }, source: frame }, frame)).toBe(false);
		expect(isPreviewReady({ data: PREVIEW_READY, source: frame }, frame)).toBe(false);
		expect(isPreviewReady({ data: null, source: frame }, frame)).toBe(false);
		expect(isPreviewReady({ data: undefined, source: frame }, frame)).toBe(false);
	});
});
