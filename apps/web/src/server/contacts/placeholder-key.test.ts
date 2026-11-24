import { describe, expect, it } from 'vite-plus/test';

import { placeholderKeyFromName } from './placeholder-key';

describe(placeholderKeyFromName, () => {
	it.each([
		['Mitglied seit (alt)', 'mitgliedSeitAlt'],
		['Größe', 'groesse'],
		['Ärger Über Öl', 'aergerUeberOel'],
		['Straße', 'strasse'],
		['Café Crème', 'cafeCreme'],
		['Notiz', 'notiz'],
		['123', 'field123'],
		['3 Kinder', 'field3Kinder'],
		['!!!', 'field'],
		['', 'field'],
		['  Eintritt   Jahr  ', 'eintrittJahr'],
	])('turns %j into %s', (name, expected) => {
		expect(placeholderKeyFromName(name, new Set())).toBe(expected);
	});

	it('numbers a key that is taken', () => {
		expect(placeholderKeyFromName('Größe', new Set(['groesse']))).toBe('groesse2');
		expect(placeholderKeyFromName('Größe', new Set(['groesse', 'groesse2']))).toBe('groesse3');
	});
});
