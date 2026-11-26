/*
 * The expected refusals of the connection and sender functions as the results the server
 * functions return. Anything else is no expected refusal and stays an error.
 */
import {
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
} from './errors';
import type { ConnectionField, SenderField } from './errors';

/** Why a change of a connection or sender was refused. */
type SendingFailure = Readonly<
	| { ok: false; failure: 'nameTaken' | 'emailTaken' | 'changed' | 'gone' }
	| { ok: false; failure: 'invalid'; field: ConnectionField | SenderField }
	| { ok: false; failure: 'connectionInUse'; senders: number }
	| { ok: false; failure: 'senderInUse'; reason: 'entries' | 'occasions' }
	| { ok: false; failure: 'areaInUse'; occasions: readonly string[] }
>;

/**
 * The refusals of a missing, taken or stale record, or of an invalid value.
 *
 * @param error What was thrown.
 * @returns The failure, or null.
 */
function recordFailure(error: unknown): SendingFailure | null {
	if (error instanceof ConnectionNameTakenError) return { failure: 'nameTaken', ok: false };
	if (error instanceof SenderEmailTakenError) return { failure: 'emailTaken', ok: false };
	if (error instanceof ConnectionChangedError || error instanceof SenderChangedError) {
		return { failure: 'changed', ok: false };
	}
	if (error instanceof ConnectionNotFoundError || error instanceof SenderNotFoundError) {
		return { failure: 'gone', ok: false };
	}
	return null;
}

/**
 * The refusals of a connection or sender that is in use, or of an invalid value.
 *
 * @param error What was thrown.
 * @returns The failure, or null.
 */
function usageFailure(error: unknown): SendingFailure | null {
	if (error instanceof ConnectionInvalidError || error instanceof SenderInvalidError) {
		return { failure: 'invalid', field: error.field, ok: false };
	}
	if (error instanceof ConnectionInUseError) {
		return { failure: 'connectionInUse', ok: false, senders: error.senders };
	}
	if (error instanceof SenderInUseError) {
		return { failure: 'senderInUse', ok: false, reason: error.reason };
	}
	if (error instanceof SenderAreaInUseError) {
		return { failure: 'areaInUse', occasions: error.occasions, ok: false };
	}
	return null;
}

/**
 * The result for an error of a change of a connection or sender.
 *
 * @param error What was thrown.
 * @returns The failure, or null when the error is not an expected refusal.
 */
function sendingFailure(error: unknown): SendingFailure | null {
	return recordFailure(error) ?? usageFailure(error);
}

export { sendingFailure };
export type { SendingFailure };
