import { describe, expect, it } from 'vite-plus/test';

import { importHtml } from './import-html';
import type { ImportKind, ImportResult } from './import-html';
import { htmlOf, refusalsOf } from './testing';

const KEYS = [
	'brand.fontFamily',
	'brand.name',
	'brand.primaryColor',
	'brand.website',
	'contact.firstName',
	'salutation',
];
const KNOWN = [...KEYS, 'contact.birthDate', 'content'];
const ORIGIN = 'https://verein.example.org';
const TEMPLATE: ImportKind = {
	allowed: { keys: new Set(KEYS), known: new Set(KNOWN) },
	areaMediaIds: new Set(),
	kind: 'template',
};
const LAYOUT: ImportKind = {
	allowed: { keys: new Set([...KEYS, 'content']), known: new Set(KNOWN) },
	areaMediaIds: new Set(),
	kind: 'ownLayout',
};

/**
 * Imports a body.
 *
 * @param body The body.
 * @param kind What is imported.
 * @returns The result.
 */
function run(body: string, kind: ImportKind = TEMPLATE): ImportResult {
	return importHtml(`<html lang="de"><head></head><body>${body}</body></html>`, kind, ORIGIN);
}

/**
 * The cleaned HTML of a body that must import.
 *
 * @param body The body.
 * @param kind What is imported.
 * @returns The HTML.
 */
function importedHtml(body: string, kind: ImportKind = TEMPLATE): string {
	return htmlOf(run(body, kind));
}

describe('placeholders in text', () => {
	it('stays as it is written', () => {
		const html = importedHtml('<p>{{salutation}}, {{ contact.firstName | "Mitglied" }}!</p>');
		expect(html).toContain('<p>{{salutation}}, {{contact.firstName | "Mitglied"}}!</p>');
	});

	it('keeps the characters of a fallback', () => {
		expect(importedHtml('<p>{{contact.firstName | "Tom &amp; Jerry"}}</p>')).toContain(
			'"Tom & Jerry"',
		);
	});

	it('refuses a placeholder the area may not use', () => {
		expect(run('<p>{{contact.birthDate}}</p>')).toStrictEqual({
			ok: false,
			refusals: [{ key: 'contact.birthDate', kind: 'placeholderForbidden' }],
		});
	});

	it('refuses an unknown placeholder', () => {
		expect(run('<p>{{contact.nickname}}</p>')).toStrictEqual({
			ok: false,
			refusals: [{ key: 'contact.nickname', kind: 'placeholderUnknown' }],
		});
	});

	it('names every refused key once', () => {
		const result = run('<p>{{contact.nickname}} {{contact.nickname}} {{contact.birthDate}}</p>');
		expect(result).toMatchObject({ ok: false });
		expect(refusalsOf(result)).toHaveLength(2);
	});

	it('refuses broken syntax', () => {
		expect(run('<p>{{contact.firstName</p>')).toStrictEqual({
			ok: false,
			refusals: [{ kind: 'syntax' }],
		});
	});

	it.each(['<', '>', '&amp;copy'])('refuses a fallback that cannot be written back: %s', (text) => {
		expect(run(`<p>{{contact.firstName | "a${text}b"}}</p>`)).toStrictEqual({
			ok: false,
			refusals: [{ kind: 'syntax' }],
		});
	});

	it('removes the compiler markers from the source', () => {
		const [start, end, tokenStart, tokenEnd] = [57_344, 57_345, 57_346, 57_347].map((codePoint) =>
			String.fromCodePoint(codePoint),
		);
		const html = importedHtml(`<p>a${start} 0${end}b ${tokenStart} 0${tokenEnd}</p>`);
		expect(html).toContain('<p>a 0b  0</p>');
	});
});

describe('placeholders outside text', () => {
	it('allows a brand value in a style attribute and in a style sheet', () => {
		const html = importedHtml(
			"<style>p{color:{{brand.primaryColor}}}</style><p style='color:{{brand.primaryColor}};font-family:{{brand.fontFamily}}'>x</p>",
		);
		expect(html).toContain('<style>p{color:{{brand.primaryColor}}}</style>');
		expect(html).toContain(`style='color:{{brand.primaryColor}};font-family:{{brand.fontFamily}}'`);
	});

	it('allows a brand value in an attribute and in the title', () => {
		const html = importedHtml('<a href="{{brand.website}}" title="{{brand.name}}">x</a>');
		expect(html).toContain("href='{{brand.website}}'");
		expect(html).toContain("title='{{brand.name}}'");
		const withTitle = importHtml(
			'<html lang="de"><head><title>{{brand.name}}</title></head><body></body></html>',
			TEMPLATE,
			ORIGIN,
		);
		expect(withTitle).toMatchObject({ ok: true });
	});

	it.each([
		['a link', '<a href="{{contact.firstName}}">x</a>', 'href'],
		['a style attribute', '<p style="color:{{contact.firstName}}">x</p>', 'style'],
		['a style sheet', '<style>p{color:{{contact.firstName}}}</style>', 'style'],
		['an alt text', '<img src="https://c.example/a.png" alt="{{salutation}}">', 'alt'],
		['a class', '<p class="{{contact.firstName}}">x</p>', 'class'],
		['content', '<a href="{{content}}">x</a>', 'href'],
	])('refuses contact data in %s', (_name, body, attribute) => {
		const result = run(body, LAYOUT);
		expect(refusalsOf(result)).toContainEqual(
			expect.objectContaining({ attribute, kind: 'placeholderInAttribute' }),
		);
	});

	it('refuses contact data in the title', () => {
		const result = importHtml(
			'<html lang="de"><head><title>{{contact.firstName}}</title></head><body></body></html>',
			TEMPLATE,
			ORIGIN,
		);
		expect(refusalsOf(result)).toStrictEqual([
			{ attribute: 'title', key: 'contact.firstName', kind: 'placeholderInAttribute' },
		]);
	});

	it('refuses an unknown key in an attribute', () => {
		const result = run('<a href="{{brand.nope}}">x</a>');
		expect(refusalsOf(result)).toStrictEqual([{ key: 'brand.nope', kind: 'placeholderUnknown' }]);
	});

	it('refuses a fallback with a single quote in an attribute', () => {
		const result = run(`<p style="color:{{brand.primaryColor | "a'b"}}">x</p>`);
		expect(refusalsOf(result)).toStrictEqual([{ kind: 'syntax' }]);
	});
});

describe('{{content}} in a layout', () => {
	it('is needed once, as a text node of its own', () => {
		expect(importedHtml('<table><tr><td>\n  {{content}}\n</td></tr></table>', LAYOUT)).toContain(
			'{{content}}',
		);
	});

	it('is missing', () => {
		expect(run('<p>x</p>', LAYOUT)).toStrictEqual({
			ok: false,
			refusals: [{ kind: 'contentMissing' }],
		});
	});

	it('is missing when it stands inside other text', () => {
		expect(run('<p>a {{content}}</p>', LAYOUT)).toStrictEqual({
			ok: false,
			refusals: [{ kind: 'contentMissing' }],
		});
	});

	it('is missing with a fallback', () => {
		expect(run('<p>{{content | "x"}}</p>', LAYOUT)).toStrictEqual({
			ok: false,
			refusals: [{ kind: 'contentMissing' }],
		});
	});

	it('is repeated', () => {
		expect(run('<p>{{content}}</p><p>{{content}}</p>', LAYOUT)).toStrictEqual({
			ok: false,
			refusals: [{ kind: 'contentRepeated' }],
		});
	});

	it('is no placeholder of a template', () => {
		expect(run('<p>{{content}}</p>')).toStrictEqual({
			ok: false,
			refusals: [{ key: 'content', kind: 'placeholderForbidden' }],
		});
	});

	it('takes the brand values and base fields of a global layout only', () => {
		const global: ImportKind = {
			allowed: {
				keys: new Set(['brand.name', 'content', 'contact.firstName']),
				known: new Set(KNOWN),
			},
			brandMediaIds: new Set(),
			kind: 'globalLayout',
		};
		expect(run('<p>{{brand.name}}</p><p>{{content}}</p>', global)).toMatchObject({ ok: true });
		expect(run('<p>{{salutation}}</p><p>{{content}}</p>', global)).toStrictEqual({
			ok: false,
			refusals: [{ key: 'salutation', kind: 'placeholderForbidden' }],
		});
	});
});

describe('a URL with a placeholder', () => {
	it('stays for an address brand value as the whole value', () => {
		expect(importedHtml('<a href="{{brand.website}}">x</a>')).toContain("href='{{brand.website}}'");
	});

	it.each([
		['a brand value that is no address', '<a href="{{brand.name}}">x</a>'],
		['a fallback with a script', '<a href=\'{{brand.website | "javascript:alert(1)"}}\'>x</a>'],
		[
			'a fallback with an https address',
			'<a href=\'{{brand.website | "https://example.org"}}\'>x</a>',
		],
		['a suffix', '<a href="{{brand.website}}/impressum">x</a>'],
	])('is refused for %s', (_name, body) => {
		expect(refusalsOf(run(body))).not.toStrictEqual([]);
	});
});
