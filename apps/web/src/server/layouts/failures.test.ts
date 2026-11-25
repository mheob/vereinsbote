import { describe, expect, it } from 'vite-plus/test';

import {
	LayoutChangedError,
	LayoutInUseError,
	LayoutNameInvalidError,
	LayoutNameTakenError,
	LayoutNotFoundError,
	TemplateChangedError,
} from '@/server/templates/errors';

import { layoutFailure } from './failures';

describe(layoutFailure, () => {
	it('turns the expected refusals into results', () => {
		expect(layoutFailure(new LayoutNameTakenError())).toStrictEqual({
			failure: 'nameTaken',
			ok: false,
		});
		expect(layoutFailure(new LayoutNameInvalidError())).toStrictEqual({
			failure: 'nameInvalid',
			ok: false,
		});
		expect(layoutFailure(new LayoutChangedError())).toStrictEqual({
			failure: 'changed',
			ok: false,
		});
		expect(layoutFailure(new LayoutNotFoundError())).toStrictEqual({ failure: 'gone', ok: false });
		expect(layoutFailure(new LayoutInUseError(3))).toStrictEqual({
			failure: 'inUse',
			ok: false,
			templates: 3,
		});
	});

	it('leaves anything else an error', () => {
		expect(layoutFailure(new Error('boom'))).toBeNull();
		expect(layoutFailure(new TemplateChangedError())).toBeNull();
		expect(layoutFailure('text')).toBeNull();
	});
});
