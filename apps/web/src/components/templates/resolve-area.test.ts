import { describe, expect, it } from 'vite-plus/test';

import { resolveAreaId } from './resolve-area';

describe(resolveAreaId, () => {
	const areas = [{ id: 'a' }, { id: 'b' }];

	it('keeps the chosen area while it is offered', () => {
		expect(resolveAreaId(areas, 'b')).toBe('b');
	});

	it('falls back to the first area when the chosen one is gone', () => {
		expect(resolveAreaId(areas, 'x')).toBe('a');
	});

	it('gives an empty id without areas', () => {
		expect(resolveAreaId([], 'a')).toBe('');
	});
});
