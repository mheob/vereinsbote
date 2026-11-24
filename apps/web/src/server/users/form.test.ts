import { describe, expect, it } from 'vite-plus/test';

import { invalidInviteFields } from './form';

describe(invalidInviteFields, () => {
	it('accepts a name and an address with spaces around them', () => {
		expect(invalidInviteFields({ email: ' Kim@Verein.de ', name: ' Kim ' })).toStrictEqual([]);
	});

	it('names every refused field in form order', () => {
		expect(invalidInviteFields({ email: 'kim@localhost', name: '   ' })).toStrictEqual([
			'name',
			'email',
		]);
	});

	it('refuses names and addresses beyond their limits', () => {
		expect(
			invalidInviteFields({ email: `${'k'.repeat(250)}@v.de`, name: 'x'.repeat(201) }),
		).toStrictEqual(['name', 'email']);
		expect(invalidInviteFields({ email: 'k@v.de', name: 'x'.repeat(200) })).toStrictEqual([]);
	});
});
