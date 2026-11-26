import { describe, expect, it } from 'vite-plus/test';

import { newMessageId, retryAfterMs } from '@/server/sending/transport';

describe(newMessageId, () => {
	it('makes message ids with 22 random characters and the sender domain', () => {
		const id = newMessageId('verein@mail.example.org');
		expect(id).toMatch(/^<[\w-]{22}@mail\.example\.org>$/u);
		expect(newMessageId('verein@mail.example.org')).not.toBe(id);
	});
});

describe(retryAfterMs, () => {
	const now = new Date('2026-11-25T09:58:00Z');

	it.each([
		['120', 120_000],
		['0', 0],
		['Wed, 25 Nov 2026 10:00:00 GMT', 120_000],
		['Wed, 25 Nov 2026 09:00:00 GMT', 0],
		['soon', null],
		['-5', null],
	])('reads Retry-After %s', (value, expected) => {
		expect(retryAfterMs(new Headers({ 'Retry-After': value }), now)).toBe(expected);
	});

	it('gives null without the header', () => {
		expect(retryAfterMs(new Headers(), now)).toBeNull();
	});
});
