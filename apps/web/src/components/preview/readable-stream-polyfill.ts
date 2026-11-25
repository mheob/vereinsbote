/*
 * Safari before 18 has no `ReadableByteStreamController`, which React's browser renderer needs
 * (`@react-email/render` builds the mail with it). The polyfill comes from npm, as its own chunk,
 * and is fetched only by a browser that lacks the feature.
 */

/** Makes sure `ReadableStream` supports byte streams, with the polyfill where it does not. */
async function ensureReadableByteStreams(): Promise<void> {
	if (Reflect.has(globalThis, 'ReadableByteStreamController')) return;
	const streams = await import('web-streams-polyfill');
	// The native `ReadableStream` of such a browser cannot be extended by one global, so the whole
	// family comes from the polyfill and stays consistent.
	Object.assign(globalThis, {
		ByteLengthQueuingStrategy: streams.ByteLengthQueuingStrategy,
		CountQueuingStrategy: streams.CountQueuingStrategy,
		ReadableByteStreamController: streams.ReadableByteStreamController,
		ReadableStream: streams.ReadableStream,
		TransformStream: streams.TransformStream,
		WritableStream: streams.WritableStream,
	});
}

export { ensureReadableByteStreams };
