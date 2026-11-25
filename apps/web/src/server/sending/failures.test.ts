import { describe, expect, it } from 'vite-plus/test';

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
import { sendingFailure } from './failures';

describe(sendingFailure, () => {
	it('maps every refusal to its result', () => {
		const cases = [
			[new ConnectionNameTakenError(), { failure: 'nameTaken', ok: false }],
			[new SenderEmailTakenError(), { failure: 'emailTaken', ok: false }],
			[new ConnectionChangedError(), { failure: 'changed', ok: false }],
			[new SenderChangedError(), { failure: 'changed', ok: false }],
			[new ConnectionNotFoundError(), { failure: 'gone', ok: false }],
			[new SenderNotFoundError(), { failure: 'gone', ok: false }],
			[new ConnectionInvalidError('name'), { failure: 'invalid', field: 'name', ok: false }],
			[new SenderInvalidError('email'), { failure: 'invalid', field: 'email', ok: false }],
			[new ConnectionInUseError(2), { failure: 'connectionInUse', ok: false, senders: 2 }],
			[new SenderInUseError('entries'), { failure: 'senderInUse', ok: false, reason: 'entries' }],
			[new SenderAreaInUseError(['a']), { failure: 'areaInUse', occasions: ['a'], ok: false }],
		] as const;
		expect(cases.map(([error]) => sendingFailure(error))).toStrictEqual(
			cases.map(([, expected]) => expected),
		);
	});

	it('leaves any other error alone', () => {
		expect(sendingFailure(new Error('boom'))).toBeNull();
	});
});
