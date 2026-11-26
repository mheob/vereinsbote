import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';

import { sampleValues } from './preview-source';

describe(sampleValues, () => {
	it('greets the sample member with the salutation of the template', () => {
		expect(sampleValues(DEFAULT_SALUTATIONS.du).get('salutation')).toBe('Liebe Anna');
		expect(sampleValues(DEFAULT_SALUTATIONS.sie).get('salutation')).toBe(
			'Sehr geehrte Frau Beispiel',
		);
		expect(sampleValues(DEFAULT_SALUTATIONS.du).get('contact.birthDate')).toBe('17.05.1985');
	});

	it('takes the sample contact of another kind', () => {
		expect(sampleValues(DEFAULT_SALUTATIONS.du, 'male').get('salutation')).toBe('Lieber Bernd');
		expect(sampleValues(DEFAULT_SALUTATIONS.du, 'diverse').get('salutation')).toBe('Hallo Kim');
		const organization = sampleValues(DEFAULT_SALUTATIONS.du, 'organization');
		expect(organization.get('salutation')).toBe('Sehr geehrte Damen und Herren');
		expect(organization.get('contact.organization')).toBe('Beispiel GmbH');
	});
});
