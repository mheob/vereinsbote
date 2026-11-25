/* oxlint-disable max-classes-per-file -- the typed refusals of the sending modules live together */
/*
 * The expected refusals of the connection and sender modules. The server functions turn them into
 * results; no message names an address, a name or a secret.
 */

/** The field of a form that a refused value belongs to. */
type ConnectionField =
	| 'clientId'
	| 'dailyLimit'
	| 'kind'
	| 'name'
	| 'perMinute'
	| 'secret'
	| 'secretExpiresOn'
	| 'tenantId';

type SenderField =
	| 'archiveBcc'
	| 'areaIds'
	| 'connectionId'
	| 'dailyLimit'
	| 'displayName'
	| 'email'
	| 'perMinute'
	| 'probeMailbox'
	| 'replyTo';

/** No connection has the id, e.g. it was deleted in another tab. */
class ConnectionNotFoundError extends Error {
	public constructor() {
		super('Unknown connection.');
		this.name = 'ConnectionNotFoundError';
	}
}

/** Somebody saved or deleted the connection since it was loaded: the version does not match. */
class ConnectionChangedError extends Error {
	public constructor() {
		super('The connection was changed in the meantime.');
		this.name = 'ConnectionChangedError';
	}
}

/** Senders use the connection; `senders` says how many. */
class ConnectionInUseError extends Error {
	public readonly senders: number;

	public constructor(senders: number) {
		super('Senders use the connection.');
		this.name = 'ConnectionInUseError';
		this.senders = senders;
	}
}

/** Another connection has the name, ignoring case. */
class ConnectionNameTakenError extends Error {
	public constructor() {
		super('A connection has this name.');
		this.name = 'ConnectionNameTakenError';
	}
}

/** A value of the connection form is missing or out of range; `field` says which. */
class ConnectionInvalidError extends Error {
	public readonly field: ConnectionField;

	public constructor(field: ConnectionField) {
		super('A value of the connection is invalid.');
		this.name = 'ConnectionInvalidError';
		this.field = field;
	}
}

/** No sender has the id, e.g. it was deleted in another tab. */
class SenderNotFoundError extends Error {
	public constructor() {
		super('Unknown sender.');
		this.name = 'SenderNotFoundError';
	}
}

/** Somebody saved or deleted the sender since it was loaded: the version does not match. */
class SenderChangedError extends Error {
	public constructor() {
		super('The sender was changed in the meantime.');
		this.name = 'SenderChangedError';
	}
}

/** Another sender has the address (compared normalized). */
class SenderEmailTakenError extends Error {
	public constructor() {
		super('A sender has this address.');
		this.name = 'SenderEmailTakenError';
	}
}

/** A value of the sender form is missing or out of range; `field` says which. */
class SenderInvalidError extends Error {
	public readonly field: SenderField;

	public constructor(field: SenderField) {
		super('A value of the sender is invalid.');
		this.name = 'SenderInvalidError';
		this.field = field;
	}
}

/**
 * The sender cannot be deleted: an occasion uses it (`occasions`) or the outbox holds open
 * entries from it (`entries`).
 */
class SenderInUseError extends Error {
	public readonly reason: 'entries' | 'occasions';

	public constructor(reason: 'entries' | 'occasions') {
		super('The sender is in use.');
		this.name = 'SenderInUseError';
		this.reason = reason;
	}
}

/** An area cannot be taken from the sender: these occasions (ids) of the area use it. */
class SenderAreaInUseError extends Error {
	public readonly occasions: readonly string[];

	public constructor(occasions: readonly string[]) {
		super('Occasions of the area use the sender.');
		this.name = 'SenderAreaInUseError';
		this.occasions = occasions;
	}
}

export {
	ConnectionChangedError,
	ConnectionInUseError,
	ConnectionInvalidError,
	ConnectionNameTakenError,
	ConnectionNotFoundError,
	SenderAreaInUseError,
	SenderChangedError,
	SenderEmailTakenError,
	SenderInUseError,
	SenderInvalidError,
	SenderNotFoundError,
};
export type { ConnectionField, SenderField };
