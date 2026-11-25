import { afterEach, describe, expect, it } from 'vite-plus/test';

import { ensureReadableByteStreams } from './readable-stream-polyfill';

const NAMES = ['ReadableByteStreamController', 'ReadableStream'] as const;
const originals = new Map(NAMES.map((name) => [name, Reflect.get(globalThis, name)]));

describe(ensureReadableByteStreams, () => {
	afterEach(() => {
		for (const [name, value] of originals) Reflect.set(globalThis, name, value);
	});

	it('leaves a browser that has byte streams alone', async () => {
		await ensureReadableByteStreams();
		expect(globalThis.ReadableStream).toBe(originals.get('ReadableStream'));
	});

	it('installs the streams of the polyfill when byte streams are missing', async () => {
		Reflect.deleteProperty(globalThis, 'ReadableByteStreamController');
		await ensureReadableByteStreams();
		expect(globalThis.ReadableByteStreamController).not.toBe(
			originals.get('ReadableByteStreamController'),
		);
		expect(globalThis.ReadableStream).not.toBe(originals.get('ReadableStream'));
		expect(new ReadableStream({ type: 'bytes' })).toBeInstanceOf(ReadableStream);
	});
});
