import { describe, expect, it } from 'vite-plus/test';

import { withoutTrailingSlashes } from './trailing-slashes';

describe(withoutTrailingSlashes, () => {
	it.each([
		['https://verein.example', 'https://verein.example'],
		['https://verein.example/', 'https://verein.example'],
		['https://verein.example///', 'https://verein.example'],
		['https://verein.example/a/', 'https://verein.example/a'],
		['https://verein.example/a/b', 'https://verein.example/a/b'],
		['/', ''],
		['', ''],
	])('turns %j into %j', (value, expected) => {
		expect(withoutTrailingSlashes(value)).toBe(expected);
	});

	it('keeps slashes before the end', () => {
		expect(withoutTrailingSlashes(`${'/'.repeat(5)}a`)).toBe('/////a');
	});

	it('handles a long run of slashes in linear time', () => {
		const value = `${'/'.repeat(100_000)}a${'/'.repeat(100_000)}`;
		expect(withoutTrailingSlashes(value)).toBe(`${'/'.repeat(100_000)}a`);
	});
});
