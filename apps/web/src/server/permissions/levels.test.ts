import { describe, expect, it } from 'vite-plus/test';

import { levelAtLeast } from './levels';

describe(levelAtLeast, () => {
	it.each([
		[null, 'read', false],
		['read', 'read', true],
		['read', 'edit', false],
		['edit', 'read', true],
		['send', 'edit', true],
		['edit', 'send', false],
		['send', 'send', true],
		['send', 'read', true],
	] as const)('%s >= %s is %s', (have, need, ok) => {
		expect(levelAtLeast(have, need)).toBe(ok);
	});
});
