import { describe, expect, it } from 'vite-plus/test';

import { GMAIL_CLIP_BYTES, importHtml } from './import-html';
import type { ImportFinding, ImportKind } from './import-html';
import { findingsOf as findingsOfResult, imported } from './testing';

const KIND: ImportKind = {
	allowed: { keys: new Set(), known: new Set() },
	areaMediaIds: new Set(),
	kind: 'template',
};

/**
 * The findings of a body in a document with a language.
 *
 * @param body The body.
 * @param head The head.
 * @returns The findings.
 */
function findingsOf(body: string, head = ''): readonly ImportFinding[] {
	return findingsOfResult(
		importHtml(
			`<html lang="en"><head>${head}</head><body>${body}</body></html>`,
			KIND,
			'https://verein.example.org',
		),
	);
}

/**
 * The kinds of findings.
 *
 * @param findings The findings.
 * @returns Their kinds.
 */
/**
 * The properties the outlookCss findings name.
 *
 * @param findings The findings.
 * @returns The properties.
 */
const outlookProperties = (findings: readonly ImportFinding[]): string[] =>
	findings.flatMap((finding) => (finding.kind === 'outlookCss' ? [finding.property] : []));

const kindsOf = (findings: readonly ImportFinding[]): string[] => findings.map(({ kind }) => kind);

describe('findings', () => {
	it('report CSS classic Outlook ignores, by property', () => {
		const findings = findingsOf(
			'<p style="display:flex;float:left">a</p><p style="display:flex;color:red;display:block">b</p>',
			'<style>.a{border-radius:4px;display:grid}</style>',
		);
		expect(findings).toContainEqual({ count: 3, kind: 'outlookCss', property: 'display' });
		expect(findings).toContainEqual({ count: 1, kind: 'outlookCss', property: 'float' });
		expect(findings).toContainEqual({ count: 1, kind: 'outlookCss', property: 'border-radius' });
		expect(outlookProperties(findings)).not.toContain('color');
	});

	it('report images without an alt text, but not an empty one', () => {
		const findings = findingsOf(
			'<img src="https://c.example/a.png"><img src="https://c.example/b.png" alt=""><img src="https://c.example/c.png">',
		);
		expect(findings).toContainEqual({ count: 2, kind: 'altMissing' });
	});

	it('report tables that are no presentation', () => {
		const findings = findingsOf(
			'<table role="presentation"><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>',
		);
		expect(findings).toContainEqual({ count: 1, kind: 'tablePresentation' });
	});

	it('report links that say nothing, once per text', () => {
		const findings = findingsOf(
			'<a href="https://a.example">Hier</a> <a href="https://b.example">  hier  </a> <a href="https://c.example">Mehr erfahren</a> <a href="https://d.example">Satzung</a>',
		);
		expect(findings.filter(({ kind }) => kind === 'vagueLink')).toStrictEqual([
			{ kind: 'vagueLink', text: 'hier' },
			{ kind: 'vagueLink', text: 'mehr erfahren' },
		]);
	});

	it('report a heading that skips a level', () => {
		expect(findingsOf('<h1>a</h1><h2>b</h2><h4>c</h4><h3>d</h3>')).toContainEqual({
			kind: 'headingOrder',
			level: 4,
		});
		expect(
			findingsOf('<h2>a</h2><h3>b</h3><h2>c</h2>').some(({ kind }) => kind === 'headingOrder'),
		).toBe(false);
	});

	it('report a language that was added, and not one that was there', () => {
		const added = imported(importHtml('<p>x</p>', KIND, 'https://verein.example.org'));
		expect(added.findings).toContainEqual({ kind: 'langAdded' });
		expect(added.html).toContain("<html lang='de'>");
		expect(kindsOf(findingsOf('<p>x</p>'))).not.toContain('langAdded');
	});

	it.each([
		[GMAIL_CLIP_BYTES + 200, true],
		[GMAIL_CLIP_BYTES - 200, false],
	])('warn when Gmail would clip a mail (%i bytes of text: %s)', (size, clipped) => {
		const kinds = kindsOf(findingsOf(`<p>${'x'.repeat(size)}</p>`));
		expect(kinds.includes('clipped')).toBe(clipped);
	});

	it('count what was removed', () => {
		const findings = findingsOf(
			'<script>a()</script><script>b()</script><p onclick="x()" onmouseover="y()">z</p>',
		);
		expect(findings).toContainEqual({ count: 2, kind: 'removed', what: 'script' });
		expect(findings).toContainEqual({ count: 2, kind: 'removed', what: 'eventHandler' });
	});
});
