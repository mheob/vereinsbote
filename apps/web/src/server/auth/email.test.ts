import { describe, expect, it } from 'vite-plus/test';

import { normalizeEmail } from './email';

describe(normalizeEmail, () => {
	it('trims and lowercases', () => {
		expect(normalizeEmail('  Anna@Verein.DE ')).toBe('anna@verein.de');
	});

	it('leaves a normalized address unchanged', () => {
		expect(normalizeEmail('anna@verein.de')).toBe('anna@verein.de');
	});
});
