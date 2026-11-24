import { describe, expect, it } from 'vite-plus/test';

import { invalidSetupFields, isValidAdminEmail, isValidAdminName } from './form';

const valid = { email: ' Admin@Verein.de ', name: ' Alex ', token: 't'.repeat(24) };

describe(invalidSetupFields, () => {
	it('accepts a complete form with spaces around name and address', () => {
		expect(invalidSetupFields(valid)).toStrictEqual([]);
	});

	it('names every refused field in form order', () => {
		expect(invalidSetupFields({ email: 'admin@localhost', name: '   ', token: '' })).toStrictEqual([
			'token',
			'name',
			'email',
		]);
	});

	it('refuses a token longer than any real one', () => {
		expect(invalidSetupFields({ ...valid, token: 't'.repeat(1025) })).toStrictEqual(['token']);
		expect(invalidSetupFields({ ...valid, token: 't'.repeat(1024) })).toStrictEqual([]);
	});
});

describe(isValidAdminName, () => {
	it('needs a name that is not only spaces and at most 200 characters long', () => {
		expect(
			[' Alex ', '', '   ', 'a'.repeat(200), 'a'.repeat(201)].map((name) => isValidAdminName(name)),
		).toStrictEqual([true, false, false, true, false]);
	});
});

describe(isValidAdminEmail, () => {
	it('needs an address with a domain, at most 254 characters long', () => {
		const long = `${'a'.repeat(245)}@verein.de`;
		expect(
			[' Admin@Verein.de ', 'admin@localhost', 'admin', '', long].map((email) =>
				isValidAdminEmail(email),
			),
		).toStrictEqual([true, false, false, false, false]);
	});
});
