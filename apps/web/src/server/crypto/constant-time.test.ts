import { describe, expect, it } from 'vite-plus/test';

import { secretsMatch } from './constant-time';

describe(secretsMatch, () => {
	it('matches equal values', async () => {
		await expect(secretsMatch('Bearer abc', 'Bearer abc')).resolves.toBe(true);
	});

	it.each([
		['a different value', 'Bearer abd'],
		['a prefix', 'Bearer ab'],
		['a longer value', 'Bearer abcd'],
		['an empty value', ''],
	])('rejects %s', async (_case, given) => {
		await expect(secretsMatch(given, 'Bearer abc')).resolves.toBe(false);
	});
});
