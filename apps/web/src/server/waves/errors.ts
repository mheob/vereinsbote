/* oxlint-disable max-classes-per-file -- the typed refusals of the wave modules live together */
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

/** No wave has the id (any more). */
class WaveNotFoundError extends Error {
	public constructor() {
		super('The wave does not exist.');
		this.name = 'WaveNotFoundError';
	}
}

/** No outbox entry of a wave has the id (any more). */
class WaveEntryNotFoundError extends Error {
	public constructor() {
		super('The entry of the wave does not exist.');
		this.name = 'WaveEntryNotFoundError';
	}
}

/** The entry is not in the state the action needs: only an `uncertain` entry is sent again. */
class WaveEntryStateError extends Error {
	public constructor() {
		super('The entry of the wave is not uncertain.');
		this.name = 'WaveEntryStateError';
	}
}

/** The wave of the entry was stopped: it sends nothing more, not even an uncertain entry. */
class WaveStoppedError extends Error {
	public constructor() {
		super('The wave was stopped.');
		this.name = 'WaveStoppedError';
	}
}

/**
 * The provider did not take a test mail. `uncertain`: the request went out and its outcome is
 * unknown, so the mail may still arrive; it counts as sent.
 */
class TestMailNotSentError extends Error {
	public readonly uncertain: boolean;

	public constructor(uncertain: boolean) {
		super('The test mail was not sent.');
		this.name = 'TestMailNotSentError';
		this.uncertain = uncertain;
	}
}

export {
	TestMailNotSentError,
	WaveAttachmentsGoneError,
	WaveEntryNotFoundError,
	WaveEntryStateError,
	WaveNotFoundError,
	WaveStoppedError,
};
