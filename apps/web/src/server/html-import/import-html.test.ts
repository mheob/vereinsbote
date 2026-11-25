import { describe, expect, it } from 'vite-plus/test';

import { importHtml, MAX_IMPORT_BYTES } from './import-html';
import type { ImportKind } from './import-html';
import { findUnsafe, htmlOf, imported, refusalsOf } from './testing';

const IMAGE = 'AAAAAAAAAAAAAAAAAAAAAA';
const ORIGIN = 'https://verein.example.org';
const KEYS = ['brand.name', 'brand.primaryColor', 'contact.firstName', 'salutation'];
const TEMPLATE: ImportKind = {
	allowed: { keys: new Set(KEYS), known: new Set([...KEYS, 'content']) },
	areaMediaIds: new Set([IMAGE]),
	kind: 'template',
};

/** The shape of a React Email export: doctype, conditional comments, tables, inline styles. */
const REACT_EMAIL = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr"><head><meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/><meta name="x-apple-disable-message-reformatting"/><!--$--><style>@media only screen and (max-width:600px){.col{display:block!important}}</style></head><body style="background-color:#f6f9fc;font-family:Arial,sans-serif"><div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">Preview text<div></div></div><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:37.5em;background-color:#ffffff"><tbody><tr style="width:100%"><td><img alt="Verein" height="40" src="${ORIGIN}/media/${IMAGE}.png" style="display:block;outline:none;border:none" width="120"/><h1 style="font-size:24px;color:{{brand.primaryColor}}">Hallo {{contact.firstName | "Mitglied"}}</h1><p style="font-size:16px">{{salutation}}, wir laden dich ein.</p><a href="https://example.org/anmeldung" style="color:#067df7;text-decoration:none" target="_blank">Zur Anmeldung</a></td></tr></tbody></table><!--/$--></body></html>`;

describe(importHtml, () => {
	it('imports a React Email export', () => {
		const result = imported(importHtml(REACT_EMAIL, TEMPLATE, ORIGIN));
		expect(result.mediaIds).toStrictEqual([IMAGE]);
		expect(result.findings).toContainEqual({ kind: 'langAdded' });
		expect(findUnsafe(result.html)).toStrictEqual([]);
	});

	it.each([
		"lang='de'",
		'Hallo {{contact.firstName | "Mitglied"}}',
		'{{salutation}}, wir laden dich ein.',
		'color:{{brand.primaryColor}}',
		`src='/media/${IMAGE}.png'`,
	])('keeps %s of a React Email export', (kept) => {
		expect(htmlOf(importHtml(REACT_EMAIL, TEMPLATE, ORIGIN))).toContain(kept);
	});

	it('drops the comments of React', () => {
		expect(htmlOf(importHtml(REACT_EMAIL, TEMPLATE, ORIGIN))).not.toContain('<!--$-->');
	});

	it('gives the same HTML for its own output', () => {
		const first = imported(importHtml(REACT_EMAIL, TEMPLATE, ORIGIN));
		expect(importHtml(first.html, TEMPLATE, ORIGIN)).toMatchObject({ html: first.html, ok: true });
	});

	it('turns a fragment into a document', () => {
		const result = importHtml('<p>Hallo {{salutation}}</p>', TEMPLATE, ORIGIN);
		expect(htmlOf(result)).toBe(
			"<!DOCTYPE html><html lang='de'><head></head><body><p>Hallo {{salutation}}</p></body></html>",
		);
	});

	it('collects every refusal of a document', () => {
		const result = importHtml(
			`<p>{{contact.nope}}</p><img src="/media/BBBBBBBBBBBBBBBBBBBBBB.png" alt="">`,
			TEMPLATE,
			ORIGIN,
		);
		expect(refusalsOf(result)).toStrictEqual([
			{ key: 'contact.nope', kind: 'placeholderUnknown' },
			{ kind: 'mediaForeign', mediaId: 'BBBBBBBBBBBBBBBBBBBBBB' },
		]);
	});

	it('refuses above 500 KB before parsing', () => {
		expect(importHtml('x'.repeat(MAX_IMPORT_BYTES + 1), TEMPLATE, ORIGIN)).toStrictEqual({
			ok: false,
			refusals: [{ kind: 'tooLarge' }],
		});
	});

	it('takes exactly 500 KB', () => {
		expect(importHtml('x'.repeat(MAX_IMPORT_BYTES), TEMPLATE, ORIGIN)).toMatchObject({ ok: true });
	});

	it('counts the size in bytes', () => {
		const text = 'ä'.repeat(MAX_IMPORT_BYTES / 2 + 1);
		expect(importHtml(text, TEMPLATE, ORIGIN)).toMatchObject({ ok: false });
	});

	it('survives an origin that does not parse', () => {
		expect(importHtml('<p>x</p>', TEMPLATE, 'not a url')).toMatchObject({ ok: true });
	});

	it.each([
		'<<script>script>alert(1)<</script>/script>',
		'<a href="x" href="javascript:alert(1)">y</a>',
		'<img src=x onerror=alert(1)//',
		'<p title="</p><script>alert(1)</script>">x</p>',
		'<table><tr><td><svg><style><img src=x onerror=alert(1)></style></svg></td></tr></table>',
		'<select><template><script>alert(1)</script></template></select>',
		'<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
		'<title><script>alert(1)</script></title>',
		'<textarea><script>alert(1)</script></textarea>',
		'<style>p{color:red}</style\n><script>alert(1)</script>',
		'<xmp><script>alert(1)</script></xmp>',
		'<noembed><img src=x onerror=alert(1)></noembed>',
		'\u0000<scr\u0000ipt>alert(1)</script>',
	])('survives hostile and broken markup: %s', (source) => {
		const result = importHtml(source, TEMPLATE, ORIGIN);
		expect(findUnsafe(imported(result).html)).toStrictEqual([]);
	});
});
