import { describe, expect, it } from 'vite-plus/test';

import { isForeignKeyViolation, isUniqueViolation } from './errors';

describe('sQLSTATE checks', () => {
	it('find the code on the error or on its cause', () => {
		expect(isForeignKeyViolation({ cause: { code: '23503' } })).toBe(true);
		expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
		expect(isUniqueViolation({ cause: { cause: { code: '23505' } } })).toBe(true);
		expect(isUniqueViolation('nope')).toBe(false);
		expect(isUniqueViolation(null)).toBe(false);
	});
});
