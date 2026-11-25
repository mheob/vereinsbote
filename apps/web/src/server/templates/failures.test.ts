import { describe, expect, it } from 'vite-plus/test';

import { UnknownAreaError } from '@/server/contacts/errors';
import { StorageNotConfiguredError } from '@/server/storage/storage';

import {
	LayoutNotFoundError,
	TemplateChangedError,
	TemplateInvalidError,
	TemplateNameTakenError,
	TemplateNotFoundError,
} from './errors';
import { createFailure, deleteFailure, duplicateFailure, saveFailure } from './failures';

describe(createFailure, () => {
	it('turns the expected refusals into results', () => {
		expect(createFailure(new TemplateNameTakenError())).toStrictEqual({
			failure: 'nameTaken',
			ok: false,
		});
		expect(createFailure(new TemplateInvalidError([{ kind: 'nameEmpty' }]))).toStrictEqual({
			failure: 'invalid',
			ok: false,
		});
		expect(createFailure(new UnknownAreaError())).toStrictEqual({ failure: 'gone', ok: false });
		expect(createFailure(new LayoutNotFoundError())).toStrictEqual({ failure: 'gone', ok: false });
	});

	it('leaves anything else an error', () => {
		expect(createFailure(new Error('boom'))).toBeNull();
		expect(createFailure(new TemplateChangedError())).toBeNull();
		expect(createFailure('text')).toBeNull();
	});
});

describe(duplicateFailure, () => {
	it('turns the expected refusals into results', () => {
		expect(duplicateFailure(new TemplateNameTakenError())).toStrictEqual({
			failure: 'nameTaken',
			ok: false,
		});
		expect(duplicateFailure(new StorageNotConfiguredError())).toStrictEqual({
			failure: 'storageMissing',
			ok: false,
		});
		expect(duplicateFailure(new TemplateNotFoundError())).toStrictEqual({
			failure: 'gone',
			ok: false,
		});
		expect(duplicateFailure(new UnknownAreaError())).toStrictEqual({ failure: 'gone', ok: false });
	});

	it('names the placeholders the target area does not allow', () => {
		const error = new TemplateInvalidError([
			{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'subject' },
		]);
		expect(duplicateFailure(error)).toStrictEqual({
			failure: 'forbiddenPlaceholders',
			keys: ['contact.birthDate'],
			ok: false,
		});
	});

	it('leaves other problems of the copy an error', () => {
		expect(duplicateFailure(new TemplateInvalidError([{ kind: 'tooBig' }]))).toBeNull();
		expect(duplicateFailure(new Error('boom'))).toBeNull();
	});
});

describe(deleteFailure, () => {
	it('turns the expected refusals into results', () => {
		expect(deleteFailure(new TemplateNotFoundError())).toStrictEqual({
			failure: 'gone',
			ok: false,
		});
		expect(deleteFailure(new TemplateChangedError())).toStrictEqual({
			failure: 'changed',
			ok: false,
		});
	});

	it('leaves anything else an error', () => {
		expect(deleteFailure(new Error('boom'))).toBeNull();
	});
});

describe(saveFailure, () => {
	it('turns the expected refusals into results', () => {
		expect(saveFailure(new TemplateChangedError())).toStrictEqual({
			failure: 'changed',
			ok: false,
		});
		expect(saveFailure(new TemplateNotFoundError())).toStrictEqual({ failure: 'gone', ok: false });
		expect(saveFailure(new TemplateNameTakenError())).toStrictEqual({
			failure: 'nameTaken',
			ok: false,
		});
		expect(saveFailure(new LayoutNotFoundError())).toStrictEqual({
			failure: 'layoutGone',
			ok: false,
		});
	});

	it('returns the problems of a template that does not pass the save checks', () => {
		const problems = [{ kind: 'subjectEmpty' }, { blockId: 'image', kind: 'altMissing' }] as const;
		expect(saveFailure(new TemplateInvalidError(problems))).toStrictEqual({
			failure: 'invalid',
			ok: false,
			problems,
		});
	});

	it('leaves anything else an error', () => {
		expect(saveFailure(new UnknownAreaError())).toBeNull();
		expect(saveFailure(new Error('boom'))).toBeNull();
	});
});
