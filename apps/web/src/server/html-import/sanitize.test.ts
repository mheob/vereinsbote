import { describe, expect, it } from 'vite-plus/test';

import { importHtml } from './import-html';
import type { ImportFinding, ImportKind } from './import-html';
import { findingsOf, findUnsafe, htmlOf, imported } from './testing';
import type { Imported } from './testing';

const KEYS = [
	'brand.name',
	'brand.primaryColor',
	'brand.website',
	'contact.firstName',
	'salutation',
];
const KIND: ImportKind = {
	allowed: { keys: new Set(KEYS), known: new Set([...KEYS, 'contact.birthDate', 'content']) },
	areaMediaIds: new Set(),
	kind: 'template',
};
const ORIGIN = 'https://verein.example.org';

/**
 * Imports a body inside a document.
 *
 * @param body The body HTML.
 * @param head The head HTML.
 * @returns The result, which must be a success.
 */
function clean(body: string, head = ''): Imported {
	return imported(
		importHtml(
			`<!doctype html><html lang="de"><head>${head}</head><body>${body}</body></html>`,
			KIND,
			ORIGIN,
		),
	);
}

/**
 * What the removed findings name.
 *
 * @param findings The findings.
 * @returns The `what` of each finding of the kind `removed`.
 */
function removedOf(findings: readonly ImportFinding[]): string[] {
	return findings.flatMap((finding) => (finding.kind === 'removed' ? [finding.what] : []));
}

describe('the XSS corpus', () => {
	const corpus: {
		name: string;
		body: string;
		head?: string;
		removed: readonly string[];
	}[] = [
		{ body: '<p>a</p><script>alert(1)</script>', name: 'script', removed: ['script'] },
		{
			body: '<img src="https://x.example/a.png" alt="" onerror="alert(1)">',
			name: 'img onerror',
			removed: ['eventHandler'],
		},
		{
			body: '<a href="javascript:alert(1)">x</a>',
			name: 'javascript link',
			removed: ['unsafeUrl'],
		},
		{
			body: '<a href="JaVaScRiPt:alert(1)">x</a>',
			name: 'mixed case javascript link',
			removed: ['unsafeUrl'],
		},
		{
			body: '<a href=" jav&#x09;ascript:alert(1)">x</a>',
			name: 'javascript link with a tab',
			removed: ['unsafeUrl'],
		},
		{
			body: '<a href="&#106;avascript:alert(1)">x</a>',
			name: 'javascript link as character reference',
			removed: ['unsafeUrl'],
		},
		{
			body: '<a href="java\nscript:alert(1)">x</a>',
			name: 'javascript link with a line break',
			removed: ['unsafeUrl'],
		},
		{
			body: '<a href="vbscript:msgbox(1)">x</a>',
			name: 'vbscript link',
			removed: ['unsafeUrl'],
		},
		{
			body: '<a href="data:text/html,<script>alert(1)</script>">x</a>',
			name: 'data link',
			removed: ['unsafeUrl'],
		},
		{
			body: '<img src="data:image/png;base64,AAAA" alt="">',
			name: 'data image',
			removed: ['unsafeUrl'],
		},
		{
			body: '<svg><script>alert(1)</script></svg>',
			name: 'svg script',
			removed: ['object'],
		},
		{
			body: '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
			name: 'math',
			removed: ['object'],
		},
		{
			body: '<iframe src="https://evil.example"></iframe>',
			name: 'iframe',
			removed: ['frame'],
		},
		{
			body: '<form action="https://evil.example"><input name="a"></form>',
			name: 'form with input',
			removed: ['form'],
		},
		{
			body: '<object data="x.swf"></object><embed src="x.swf">',
			name: 'object and embed',
			removed: ['object'],
		},
		{
			body: '<noscript><img src="x" onerror="alert(1)"></noscript>',
			name: 'noscript with img',
			removed: ['script'],
		},
		{
			body: '<!--[if mso]><script>alert(1)</script><![endif]--><p>x</p>',
			name: 'script in a conditional comment',
			removed: [],
		},
		{
			body: '<!--[if mso]>--><script>alert(1)</script><![endif]--><p>x</p>',
			name: 'conditional comment that closes itself',
			removed: ['script'],
		},
		{
			body: '<!--[if mso]><img src=x onerror=alert(1)><![endif]--><p>x</p>',
			name: 'handler in a conditional comment',
			removed: [],
		},
		{
			body: '<!--[if mso]><p>a</p>--><script>alert(1)</script><!--<![endif]--><p>x</p>',
			name: 'comment ended in the middle',
			removed: ['script'],
		},
		{
			body: '<!--[if mso]><p>--!><script>alert(1)</script></p><![endif]--><p>x</p>',
			name: 'comment ended with --!>',
			removed: [],
		},
		{
			body: '<!--[if mso]><p>--&gt;<script>alert(1)</script></p><![endif]--><p>x</p>',
			name: 'comment end hidden in a character reference',
			removed: [],
		},
		{
			body: '<p>x</p>',
			head: '<style>@import url("https://evil.example/a.css");p{color:red}</style>',
			name: 'style import',
			removed: ['unsafeCss'],
		},
		{
			body: '<p>x</p>',
			head: '<style>p{color:red}</style><script>alert(1)</script>',
			name: 'script after style',
			removed: ['script'],
		},
		{
			body: '<p>x</p>',
			head: '<style>p{color:red}</style></head><body><script>alert(1)</script>',
			name: 'style that tries to leave the head',
			removed: ['script'],
		},
		{
			body: '<p style="width:expression(alert(1))">x</p>',
			name: 'expression in a style attribute',
			removed: ['unsafeCss'],
		},
		{
			body: '<p style="background:url(javascript:alert(1))">x</p>',
			name: 'javascript url in a style attribute',
			removed: ['unsafeCss'],
		},
		{
			body: '<p style="background:url(&quot;javascript:alert(1)&quot;)">x</p>',
			name: 'quoted javascript url in a style attribute',
			removed: ['unsafeCss'],
		},
		{
			body: '<p style="behavior:url(x.htc)">x</p>',
			name: 'behavior',
			removed: ['unsafeCss'],
		},
		{
			body: '<p style="-moz-binding:url(https://evil.example/x.xml#a)">x</p>',
			name: 'moz-binding',
			removed: ['unsafeCss'],
		},
		{
			body: String.raw`<p style="width:\65xpression(alert(1))">x</p>`,
			name: 'escaped expression',
			removed: ['unsafeCss'],
		},
		{
			body: '<p>x</p>',
			head: '<style>p{color:red}</*x*/style><script>alert(1)</script></style>',
			name: 'style close hidden in a comment',
			removed: [],
		},
		{
			body: '<p>x</p>',
			head: '<style>@font-face{font-family:a;src:url(https://evil.example/a.woff)}p{color:red}</style>',
			name: 'font face',
			removed: ['unsafeCss'],
		},
		{
			body: '<p>x</p>',
			head: '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">',
			name: 'base',
			removed: ['base'],
		},
		{
			body: '<p>x</p>',
			head: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
			name: 'meta refresh',
			removed: ['metaRefresh'],
		},
		{
			body: '<p onclick="alert(1)" onmouseover=alert(1)>x</p>',
			name: 'event handlers',
			removed: ['eventHandler'],
		},
	];

	it.each(corpus)('leaves nothing that runs: $name', ({ body, head }) => {
		expect(findUnsafe(clean(body, head).html)).toStrictEqual([]);
	});

	it.each(corpus)('says what it removed: $name', ({ body, head, removed }) => {
		expect(removedOf(clean(body, head).findings)).toStrictEqual(
			expect.arrayContaining([...removed]),
		);
	});

	it.each(corpus)('gives the same HTML when it is imported again: $name', ({ body, head }) => {
		const first = clean(body, head);
		expect(importHtml(first.html, KIND, ORIGIN)).toMatchObject({ html: first.html, ok: true });
	});

	it('keeps an Outlook conditional comment with cleaned content', () => {
		const { html } = clean(
			'<!--[if mso]><table><tr><td><p onclick="x()">Outlook</p><script>alert(1)</script></td></tr></table><![endif]--><p>x</p>',
		);
		expect(html).toMatch(/<!--\[if mso\]>.*Outlook.*<!\[endif\]-->/u);
		expect(html).not.toMatch(/onclick|<script/u);
	});

	it('keeps the markers of a downlevel-revealed conditional comment', () => {
		const { html } = clean('<!--[if !mso]><!--><p>Not Outlook</p><!--<![endif]-->');
		expect(html).toContain('<!--[if !mso]><!-->');
		expect(html).toContain('<!--<![endif]-->');
	});

	it('removes other comments and counts them', () => {
		const result = clean('<!-- a note --><p>x</p><!-- [if mso] but not really -->');
		expect(result.html).not.toContain('a note');
		expect(result.findings).toContainEqual({ count: 2, kind: 'removed', what: 'comment' });
	});

	it('removes a conditional comment with an unsafe condition', () => {
		const { html } = clean('<!--[if mso><script>alert(1)</script>]><p>a</p><![endif]--><p>x</p>');
		expect(html).not.toContain('<script');
	});

	it('writes no comment that can end early', () => {
		const { html } = clean(
			'<!--[if mso]><p>a &gt; b --&gt; c</p><style>p{content:"-->"}</style><![endif]--><p>x</p>',
		);
		const values = [...html.matchAll(/<!--(?<value>.*?)-->/gsu)].map(
			(match) => match.groups?.value,
		);
		expect(values.filter((value) => value?.includes('--') === true)).toStrictEqual([]);
	});

	it('keeps layout markup', () => {
		const html = htmlOf(
			importHtml(
				'<table role="presentation" width="600" align="center" bgcolor="#ffffff" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" style="padding:10px;color:#333333">Hi <font color="red" face="Arial">there</font><center>x</center></td></tr></table>',
				KIND,
				ORIGIN,
			),
		);
		for (const kept of ["bgcolor='#ffffff'", "valign='top'", 'padding:10px', '<font', '<center>']) {
			expect(html).toContain(kept);
		}
	});

	it('drops attributes and elements a mail does not need', () => {
		const { html } = clean(
			'<img src="https://cdn.example/a.png" alt="A" id="a" data-x="1"><p id="b">x</p>',
		);
		expect(html).not.toMatch(/data-x| id=/u);
	});

	it('reports what it removed', () => {
		const findings = findingsOf(
			importHtml('<script>a()</script><iframe src="https://x.example"></iframe>', KIND, ORIGIN),
		);
		expect(findings).toContainEqual({ count: 1, kind: 'removed', what: 'script' });
		expect(findings).toContainEqual({ count: 1, kind: 'removed', what: 'frame' });
	});

	it('refuses a document that is too large', () => {
		const result = importHtml(`<p>${'x'.repeat(500 * 1024)}</p>`, KIND, ORIGIN);
		expect(result).toStrictEqual({ ok: false, refusals: [{ kind: 'tooLarge' }] });
	});
});
