import { describe, expect, it } from 'vite-plus/test';

import { isForeignKeyViolationOf, isUniqueViolation } from './errors';

describe('sQLSTATE checks', () => {
	it('find the code on the error or on its cause', () => {
		expect(isUniqueViolation({ cause: { cause: { code: '23505' } } })).toBe(true);
		expect(isUniqueViolation('nope')).toBe(false);
		expect(isUniqueViolation(null)).toBe(false);
	});

	it('name the violated foreign key', () => {
		const error = { cause: { code: '23503', constraint: 'a_fk' } };
		expect(isForeignKeyViolationOf(error, 'a_fk')).toBe(true);
		expect(isForeignKeyViolationOf(error, 'b_fk')).toBe(false);
		expect(isForeignKeyViolationOf({ code: '23001', constraint: 'a_fk' }, 'a_fk')).toBe(true);
		expect(isForeignKeyViolationOf({ code: '23505', constraint: 'a_fk' }, 'a_fk')).toBe(false);
	});
});
