import { describe, expect, it } from 'vite-plus/test';

import { t } from './t';

describe(t, () => {
	it('returns German text', () => {
		expect(t('app.name')).toBe('Vereinsbote');
	});

	it('interpolates params', () => {
		expect(t('auth.linkSent', { email: 'anna@verein.de' })).toBe(
			'Wir haben einen Anmeldelink an anna@verein.de geschickt, falls die Adresse eingeladen ist.',
		);
	});

	it('throws when a param is missing', () => {
		expect(() => t('auth.linkSent')).toThrow(/email/u);
	});
});
