import { describe, expect, it } from 'vite-plus/test';

import { UnknownAreaError } from '@/server/contacts/errors';

import {
	OccasionChangedError,
	OccasionInvalidError,
	OccasionNameTakenError,
	OccasionNotFoundError,
} from './errors';
import { occasionFailure } from './failures';

describe(occasionFailure, () => {
	it('turns the expected refusals into results', () => {
		expect(occasionFailure(new OccasionNameTakenError())).toStrictEqual({
			failure: 'nameTaken',
			ok: false,
		});
		expect(occasionFailure(new OccasionChangedError())).toStrictEqual({
			failure: 'changed',
			ok: false,
		});
		expect(occasionFailure(new OccasionInvalidError('archived'))).toStrictEqual({
			failure: 'invalid',
			ok: false,
			problem: 'archived',
		});
	});

	it('says gone for an occasion or an area that does not exist', () => {
		expect(occasionFailure(new OccasionNotFoundError())).toStrictEqual({
			failure: 'gone',
			ok: false,
		});
		expect(occasionFailure(new UnknownAreaError())).toStrictEqual({ failure: 'gone', ok: false });
	});

	it('leaves anything else an error', () => {
		expect(occasionFailure(new Error('boom'))).toBeNull();
	});
});
