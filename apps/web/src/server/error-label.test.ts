import { describe, expect, it } from 'vite-plus/test';

import { errorLabel } from './error-label';

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
