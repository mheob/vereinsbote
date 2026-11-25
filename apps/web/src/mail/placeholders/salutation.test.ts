import { describe, expect, it } from 'vite-plus/test';

import type { Gender } from '@/server/contacts/fields';

import { DEFAULT_SALUTATIONS, salutationFor } from './salutation';
import type { SalutationForm } from './salutation';

const FIRM = 'Bäckerei Körner GmbH';
const DAMEN_HERREN = 'Sehr geehrte Damen und Herren';

interface Row {
	expected: string;
	firstName: string | null;
	form: SalutationForm;
	gender: Gender;
	lastName: string | null;
	organization: string | null;
}

const row = (
	[form, gender]: readonly [SalutationForm, Gender],
	names: readonly [first: string | null, last: string | null, organization: string | null],
	expected: string,
): Row => ({
	expected,
	firstName: names[0],
	form,
	gender,
	lastName: names[1],
	organization: names[2],
});

const ANNA = ['Anna', 'Beispiel', null] as const;
const BERND = ['Bernd', 'Muster', null] as const;
const NOBODY = [null, null, null] as const;
const FIRM_ONLY = [null, null, FIRM] as const;

describe(salutationFor, () => {
	it.each<Row>([
		row(['du', 'female'], ANNA, 'Liebe Anna'),
		row(['du', 'male'], BERND, 'Lieber Bernd'),
		row(['du', 'diverse'], ANNA, 'Hallo Anna'),
		row(['du', 'unspecified'], ANNA, 'Hallo Anna'),
		row(['du', 'unspecified'], FIRM_ONLY, DAMEN_HERREN),
		row(['du', 'female'], NOBODY, 'Hallo'),
		row(['du', 'male'], NOBODY, 'Hallo'),
		row(['du', 'diverse'], NOBODY, 'Hallo'),
		row(['du', 'female'], ['  ', 'Beispiel', null], 'Hallo'),
		row(['sie', 'female'], ANNA, 'Sehr geehrte Frau Beispiel'),
		row(['sie', 'male'], BERND, 'Sehr geehrter Herr Muster'),
		row(['sie', 'diverse'], ANNA, 'Guten Tag Anna Beispiel'),
		row(['sie', 'unspecified'], ANNA, 'Guten Tag Anna Beispiel'),
		row(['sie', 'unspecified'], FIRM_ONLY, DAMEN_HERREN),
		row(['sie', 'female'], ['Anna', null, null], 'Guten Tag'),
		row(['sie', 'male'], NOBODY, 'Guten Tag'),
		row(['sie', 'unspecified'], ['Anna', null, null], 'Guten Tag'),
		row(['sie', 'unspecified'], NOBODY, 'Guten Tag'),
	])('$form $gender $firstName $lastName $organization gives $expected', (entry) => {
		expect(salutationFor(DEFAULT_SALUTATIONS[entry.form], entry)).toBe(entry.expected);
	});

	it('uses the organization case only when the first name is empty', () => {
		const contact = {
			firstName: 'Anna',
			gender: 'female',
			lastName: 'Beispiel',
			organization: 'Verein e. V.',
		} as const;
		expect(salutationFor(DEFAULT_SALUTATIONS.du, contact)).toBe('Liebe Anna');
	});

	it('inserts values literally, even when they look like placeholders', () => {
		const contact = {
			firstName: '{{contact.email}}',
			gender: 'female',
			lastName: null,
			organization: null,
		} as const;
		expect(salutationFor(DEFAULT_SALUTATIONS.du, contact)).toBe('Liebe {{contact.email}}');
	});

	it('supports edited texts', () => {
		const texts = { ...DEFAULT_SALUTATIONS.sie, other: 'Moin {{contact.organization}}' };
		const contact = {
			firstName: null,
			gender: 'unspecified',
			lastName: 'X',
			organization: null,
		} as const;
		expect(salutationFor(texts, contact)).toBe('Moin');
	});
});
