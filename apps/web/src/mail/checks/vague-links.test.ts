import { describe, expect, it } from 'vite-plus/test';

import { isVagueLinkText, VAGUE_LINK_TEXTS } from './vague-links';

describe(isVagueLinkText, () => {
	it('knows the German texts that say nothing about the target', () => {
		expect(VAGUE_LINK_TEXTS).toStrictEqual([
			'hier',
			'hier klicken',
			'klicke hier',
			'klicken sie hier',
			'mehr',
			'weiter',
			'weiterlesen',
			'mehr lesen',
			'link',
			'details',
		]);
		for (const text of VAGUE_LINK_TEXTS) expect(isVagueLinkText(text)).toBe(true);
	});

	it('ignores case, punctuation and surrounding or repeated spaces', () => {
		expect(isVagueLinkText('Hier klicken!')).toBe(true);
		expect(isVagueLinkText('  MEHR …  ')).toBe(true);
		expect(isVagueLinkText('Klicken  Sie hier.')).toBe(true);
		expect(isVagueLinkText('„Weiterlesen“')).toBe(true);
		expect(isVagueLinkText('Details →')).toBe(true);
	});

	it('finds bare addresses', () => {
		expect(isVagueLinkText('https://example.org/sommerfest')).toBe(true);
		expect(isVagueLinkText(' http://example.org ')).toBe(true);
		expect(isVagueLinkText('www.example.org')).toBe(true);
		expect(isVagueLinkText('WWW.Example.org/Programm')).toBe(true);
	});

	it('accepts texts that name the target', () => {
		expect(isVagueLinkText('Programm ansehen')).toBe(false);
		expect(isVagueLinkText('Mehr über das Sommerfest')).toBe(false);
		expect(isVagueLinkText('Hier geht es zur Anmeldung')).toBe(false);
		expect(isVagueLinkText('Mail an das Büro')).toBe(false);
		expect(isVagueLinkText('Die Webseite www.example.org')).toBe(false);
	});

	it('treats an empty text as vague', () => {
		expect(isVagueLinkText('')).toBe(true);
		expect(isVagueLinkText(' !? ')).toBe(true);
	});
});
