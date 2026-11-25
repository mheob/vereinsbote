import { describe, expect, it } from 'vite-plus/test';

import { isStartChoice, namesAfterStartChange, startDefaults } from './start-defaults';

describe(startDefaults, () => {
	it('prefills nothing for an empty template and the starter texts for a starter', () => {
		expect(startDefaults('empty')).toStrictEqual({ name: '', subject: '' });
		expect(startDefaults('invitation')).toStrictEqual({
			name: 'Einladung',
			subject: 'Einladung zu [Veranstaltung]',
		});
	});
});

describe(isStartChoice, () => {
	it('knows the choices only', () => {
		expect(isStartChoice('empty')).toBe(true);
		expect(isStartChoice('invitation')).toBe(true);
		expect(isStartChoice('import')).toBe(false);
	});
});

describe(namesAfterStartChange, () => {
	it('fills empty fields with the defaults of the new start', () => {
		expect(namesAfterStartChange({ name: '', subject: '' }, 'empty', 'invitation')).toStrictEqual({
			name: 'Einladung',
			subject: 'Einladung zu [Veranstaltung]',
		});
	});

	it('takes the defaults back when the start returns to empty untouched', () => {
		expect(
			namesAfterStartChange(
				{ name: 'Einladung', subject: 'Einladung zu [Veranstaltung]' },
				'invitation',
				'empty',
			),
		).toStrictEqual({ name: '', subject: '' });
	});

	it('keeps what the user typed', () => {
		expect(
			namesAfterStartChange({ name: 'Sommerfest', subject: '' }, 'empty', 'invitation'),
		).toStrictEqual({ name: 'Sommerfest', subject: 'Einladung zu [Veranstaltung]' });
		expect(
			namesAfterStartChange({ name: 'Sommerfest', subject: 'Hallo' }, 'invitation', 'empty'),
		).toStrictEqual({ name: 'Sommerfest', subject: 'Hallo' });
	});
});
