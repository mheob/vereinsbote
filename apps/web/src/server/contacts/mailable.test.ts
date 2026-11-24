import { describe, expect, it } from 'vite-plus/test';

import { isMailable } from './mailable';

const TODAY = '2026-11-24';
const ADDRESS = 'a@example.org';

describe(isMailable, () => {
	it.each([
		{ contact: { email: ADDRESS, exitDate: null }, expected: true, name: 'an address, no exit' },
		{
			contact: { email: ADDRESS, exitDate: '2026-11-25' },
			expected: true,
			name: 'an exit tomorrow',
		},
		{
			contact: { email: ADDRESS, exitDate: '2026-11-24' },
			expected: false,
			name: 'an exit today',
		},
		{
			contact: { email: ADDRESS, exitDate: '2026-11-23' },
			expected: false,
			name: 'an exit yesterday',
		},
		{ contact: { email: null, exitDate: null }, expected: false, name: 'no address' },
	])('says $expected for $name', ({ contact, expected }) => {
		expect(isMailable(contact, false, TODAY)).toBe(expected);
	});

	it('says false for a suppressed contact', () => {
		expect(isMailable({ email: ADDRESS, exitDate: null }, true, TODAY)).toBe(false);
	});
});
