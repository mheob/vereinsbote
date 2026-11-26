import { describe, expect, it } from 'vite-plus/test';

import { hasExited, isMailable } from './mailable';

const TODAY = '2026-11-24';
const ADDRESS = 'a@example.org';
const UNMARKED = { invalidEmail: false, suppressed: false } as const;

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
		expect(isMailable(contact, UNMARKED, TODAY)).toBe(expected);
	});

	it('says false for a suppressed contact', () => {
		const marks = { ...UNMARKED, suppressed: true };
		expect(isMailable({ email: ADDRESS, exitDate: null }, marks, TODAY)).toBe(false);
	});

	it('says false for a contact whose address is marked invalid (a hard bounce)', () => {
		const marks = { ...UNMARKED, invalidEmail: true };
		expect(isMailable({ email: ADDRESS, exitDate: null }, marks, TODAY)).toBe(false);
	});
});

describe(hasExited, () => {
	it.each([
		[null, false],
		['2026-11-25', false],
		['2026-11-24', true],
		['2026-11-23', true],
	] as const)('says for the exit date %s: %s', (exitDate, exited) => {
		expect(hasExited(exitDate, TODAY)).toBe(exited);
	});
});
