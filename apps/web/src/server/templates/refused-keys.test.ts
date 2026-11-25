import { describe, expect, it } from 'vite-plus/test';

import { refusedPlaceholderKeys } from './refused-keys';

describe(refusedPlaceholderKeys, () => {
	it('names the forbidden and unknown placeholders once each, in order', () => {
		expect(
			refusedPlaceholderKeys([
				{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'subject' },
				{ kind: 'syntax', where: 'preheader' },
				{ key: 'contact.nothing', kind: 'placeholderUnknown', where: 'block.a' },
				{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'block.b' },
			]),
		).toStrictEqual(['contact.birthDate', 'contact.nothing']);
	});

	it('gives none for problems of another kind', () => {
		expect(refusedPlaceholderKeys([{ kind: 'nameEmpty' }, { kind: 'tooBig' }])).toStrictEqual([]);
		expect(refusedPlaceholderKeys([])).toStrictEqual([]);
	});
});
