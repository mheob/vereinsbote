import { describe, expect, it } from 'vite-plus/test';

import { errorLabel, errorLabelWithCause } from './error-label';

describe(errorLabel, () => {
	it('prefers the error code over the name', () => {
		const error = Object.assign(new Error('password=x'), { code: 'ECONNREFUSED' });
		expect(errorLabel(error)).toBe('ECONNREFUSED');
	});

	it('falls back to the name without a usable code', () => {
		const withoutCode = Object.assign(new Error('x'), { code: undefined });
		const objectCode = Object.assign(new Error('x'), { code: { detail: 'x' } });
		expect(errorLabel(new TypeError('x'))).toBe('TypeError');
		expect(errorLabel(withoutCode)).toBe('Error');
		expect(errorLabel(objectCode)).toBe('Error');
	});

	it('labels non-errors as unknown', () => {
		expect(errorLabel('password=x')).toBe('unknown');
	});
});

describe(errorLabelWithCause, () => {
	it('adds the code of a wrapped cause, never a message', () => {
		const cause = Object.assign(new Error('password authentication failed'), { code: '28P01' });
		const error = new Error('Failed query: postgres://user:secret@host/db', { cause });
		expect(errorLabelWithCause(error)).toBe('Error (cause: 28P01)');
	});

	it('is the plain label without a cause', () => {
		expect(errorLabelWithCause(new TypeError('x'))).toBe('TypeError');
		expect(errorLabelWithCause('password=x')).toBe('unknown');
	});
});
