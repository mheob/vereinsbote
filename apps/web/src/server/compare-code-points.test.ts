import { describe, expect, it } from 'vite-plus/test';

import { compareCodePoints } from '@/server/compare-code-points';

describe(compareCodePoints, () => {
	it('orders by code unit like the default sort', () => {
		const values = ['b', 'a', 'B', 'custom:2', 'custom:10', 'ä'];
		expect(values.toSorted(compareCodePoints)).toStrictEqual(values.toSorted());
	});

	it('returns 0 for equal strings', () => {
		expect(compareCodePoints('a', 'a')).toBe(0);
	});
});
