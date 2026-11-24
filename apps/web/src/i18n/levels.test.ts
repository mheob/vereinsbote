import { describe, expect, it } from 'vite-plus/test';

import { areaMemberships } from '@/server/db/schema';
import { accessLevels } from '@/server/permissions/levels';

import { ACCESS_LEVELS, LEVEL_MESSAGES, NO_ACCESS } from './levels';
import { translate } from './translate';

describe('level choices', () => {
	it('offers the access levels of the schema, lowest first', () => {
		expect(ACCESS_LEVELS).toBe(accessLevels);
		expect(areaMemberships.level.enumValues).toStrictEqual([...accessLevels]);
	});

	it('names every level and no access, in both languages', () => {
		expect(Object.keys(LEVEL_MESSAGES).toSorted()).toStrictEqual(
			[...accessLevels, NO_ACCESS].toSorted(),
		);
		for (const key of Object.values(LEVEL_MESSAGES)) {
			expect(translate('de', key)).not.toBe('');
			expect(translate('en', key)).not.toBe('');
		}
	});
});
