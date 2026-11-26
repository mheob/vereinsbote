/*
 * The expected refusals of the wave module. The server functions turn them into results; no
 * message names a file, a contact or an occasion. A gone, changed or archived occasion is told by
 * the errors of the occasion module.
 */

/**
 * An attachment of the flow is no free attachment of the occasion (any more): it was removed or
 * cleaned up, it belongs to another occasion, or a wave holds it already.
 */
class WaveAttachmentsGoneError extends Error {
	public constructor() {
		super('An attachment of the wave is gone.');
		this.name = 'WaveAttachmentsGoneError';
	}
}

export { WaveAttachmentsGoneError };
