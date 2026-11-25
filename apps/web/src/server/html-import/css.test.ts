import { describe, expect, it } from 'vite-plus/test';

import { cleanDeclarations, cleanStyleSheet } from './css';
import type { CssReport } from './css';

/**
 * A report that records what it is told.
 *
 * @returns The report and what it saw.
 */
function record(): {
	report: CssReport;
	seen: { removed: number; outlook: string[]; hosts: string[] };
} {
	const seen = { hosts: [] as string[], outlook: [] as string[], removed: 0 };
	const report: CssReport = {
		externalHost: (host) => {
			seen.hosts.push(host);
		},
		mediaUrl: () => null,
		outlook: (name) => {
			seen.outlook.push(name);
		},
		removed: () => {
			seen.removed += 1;
		},
	};
	return { report, seen };
}

describe(cleanStyleSheet, () => {
	it('keeps plain rules and media queries', () => {
		const { report } = record();
		const css = cleanStyleSheet(
			'p{margin:0;color:#333}@media (max-width:600px){.vb-column{display:block!important}}',
			report,
		);
		expect(css).toBe(
			'p{margin:0;color:#333}@media (max-width:600px){.vb-column{display:block!important}}',
		);
	});

	it.each([
		['@import', '@import url("https://evil.example/a.css");p{color:red}'],
		['@font-face', '@font-face{font-family:a;src:url(https://evil.example/a.woff)}p{color:red}'],
		['@keyframes', '@keyframes a{from{color:red}to{color:blue}}p{color:red}'],
		['@charset', '@charset "utf-8";p{color:red}'],
	])('removes %s', (_name, source) => {
		expect(cleanStyleSheet(source, record().report)).toBe('p{color:red}');
	});

	it.each([
		['expression()', 'p{width:expression(alert(1));color:red}'],
		['an escaped expression', String.raw`p{width:\65 xpression(alert(1));color:red}`],
		['behavior', 'p{behavior:url(x.htc);color:red}'],
		['-moz-binding', 'p{-moz-binding:url(https://evil.example/x.xml#a);color:red}'],
		['a javascript url', 'p{background:url(javascript:alert(1));color:red}'],
		['a quoted javascript url', 'p{background:url("javascript:alert(1)");color:red}'],
		['a spaced javascript url', 'p{background:url( java\nscript:alert(1) );color:red}'],
		['a data url', 'p{background:url(data:image/png;base64,AAAA);color:red}'],
		['a relative url', 'p{background:url(x.png);color:red}'],
		['an http url', 'p{background:url(http://cdn.example/x.png);color:red}'],
		['image-set', 'p{background:image-set("a.png" 1x);color:red}'],
	])('removes the declaration with %s', (_name, source) => {
		const { report, seen } = record();
		expect(cleanStyleSheet(source, report)).toBe('p{color:red}');
		expect(seen.removed).toBeGreaterThan(0);
	});

	it('keeps an https url and reports its host', () => {
		const { report, seen } = record();
		const css = cleanStyleSheet('p{background:url(https://cdn.example/x.png)}', report);
		expect(css).toBe('p{background:url(https://cdn.example/x.png)}');
		expect(seen.hosts).toStrictEqual(['cdn.example']);
	});

	it('drops garbage after a rule, so it cannot close the style element', () => {
		const css = cleanStyleSheet('a{b:c} </*x*/style><script>alert(1)</script>', record().report);
		expect(css).toBe('a{b:c}');
	});

	it('writes no less-than sign', () => {
		const css = cleanStyleSheet('a::after{content:"</style><script>"}', record().report);
		expect(css).not.toContain('<');
	});

	it('reports what classic Outlook ignores', () => {
		const { report, seen } = record();
		cleanStyleSheet(
			'p{display:flex;float:left;color:red;display:block;background:linear-gradient(red,blue)}',
			report,
		);
		expect(seen.outlook).toStrictEqual(['display', 'float', 'linear-gradient()']);
	});

	it('removes a rule with a broken selector', () => {
		expect(cleanStyleSheet('p{color:red}a[{color:blue}', record().report)).toBe('p{color:red}');
	});
});

describe(cleanDeclarations, () => {
	it('keeps declarations and drops the unsafe ones', () => {
		expect(
			cleanDeclarations('color:red;width:expression(alert(1));margin:0', record().report),
		).toBe('color:red;margin:0');
	});

	it('gives an empty text when nothing stays', () => {
		expect(cleanDeclarations('behavior:url(x.htc)', record().report)).toBe('');
	});
});
