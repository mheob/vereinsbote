import { describe, expect, it } from 'vite-plus/test';

import { displayName } from './display-name';
import type { DisplayName, NameParts } from './display-name';

const NONE: NameParts = {
	customerNumber: null,
	email: null,
	firstName: null,
	lastName: null,
	memberNumber: null,
	organization: null,
};

describe(displayName, () => {
	it.each<[string, Partial<NameParts>, DisplayName]>([
		[
			'a person',
			{ firstName: 'Anna', lastName: 'Abel' },
			{ primary: 'Anna Abel', secondary: null },
		],
		[
			'an organization with a contact person',
			{ firstName: 'Max', lastName: 'Körner', organization: 'Bäckerei Körner GmbH' },
			{ primary: 'Bäckerei Körner GmbH', secondary: 'Max Körner' },
		],
		[
			'an organization alone',
			{ organization: 'Stadtwerke' },
			{ primary: 'Stadtwerke', secondary: null },
		],
		[
			'an address and a customer number only',
			{ customerNumber: 'K-7', email: 'info@example.org' },
			{ primary: 'info@example.org', secondary: null },
		],
		['a member number only', { memberNumber: '42' }, { primary: '42', secondary: null }],
		['a last name only', { lastName: 'Abel' }, { primary: 'Abel', secondary: null }],
	])('shows %s', (_label, parts, expected) => {
		expect(displayName({ ...NONE, ...parts })).toStrictEqual(expected);
	});
});
