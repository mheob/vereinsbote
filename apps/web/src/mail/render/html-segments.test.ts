import { describe, expect, it } from 'vite-plus/test';

import { parsePlaceholders } from '@/mail/placeholders/syntax';

import { cssValue, joinHtml, withStyleInHead } from './html-segments';
import type { Segments } from './html-segments';

/**
 * Parses a text with placeholders.
 *
 * @param text The text.
 * @returns The segments.
 */
function segmentsOf(text: string): Segments {
	const parsed = parsePlaceholders(text);
	if (!parsed.ok) throw new Error('The text does not parse.');
	return parsed.segments;
}

const resolve = (): string => 'a<b>&"c";}';

describe(cssValue, () => {
	it('keeps colours and font stacks, drops what could leave a rule', () => {
		expect(cssValue('#1f2937')).toBe('#1f2937');
		expect(cssValue('"Open Sans", Arial, sans-serif')).toBe('"Open Sans", Arial, sans-serif');
		expect(cssValue('a</style><script>x();}{@import')).toBe('astylescriptximport');
	});
});

const write = (text: string): string =>
	joinHtml(segmentsOf(text), { origin: 'https://verein.example', resolve });

describe(joinHtml, () => {
	it('escapes a value in text and attributes', () => {
		expect(write("<p title='{{brand.name}}'>{{brand.name}}</p>")).toBe(
			"<p title='a&lt;b&gt;&amp;&quot;c&quot;;}'>a&lt;b&gt;&amp;&quot;c&quot;;}</p>",
		);
	});

	it('reduces a value in a style element, in any case', () => {
		expect(write('<STYLE type=x>p{x:{{brand.name}}}</STYLE>{{brand.name}}')).toBe(
			'<STYLE type=x>p{x:ab"c"}</STYLE>a&lt;b&gt;&amp;&quot;c&quot;;}',
		);
	});

	it('does not take <styles> or <stylex for a style element', () => {
		expect(write('<styles>{{brand.name}}')).toBe('<styles>a&lt;b&gt;&amp;&quot;c&quot;;}');
	});

	it('follows a style element across placeholders', () => {
		expect(write('<style>{{brand.name}}a{{brand.name}}</style>{{brand.name}}')).toBe(
			'<style>ab"c"aab"c"</style>a&lt;b&gt;&amp;&quot;c&quot;;}',
		);
	});

	it('writes the content as it is, and the images with the origin', () => {
		const html = joinHtml(segmentsOf("<img src='/media/x.png'>{{content}}"), {
			content: '<b>x</b>',
			origin: 'https://verein.example',
			resolve,
		});
		expect(html).toBe("<img src='https://verein.example/media/x.png'><b>x</b>");
	});
});

const HEAD_STYLE = '<style>x</style>';
const writeWithStyle = (text: string): string => {
	const segments = withStyleInHead(segmentsOf(text), HEAD_STYLE);
	return joinHtml(segments, { content: '[C]', origin: '', resolve });
};

describe(withStyleInHead, () => {
	it('puts the element before the end of the head, in any case', () => {
		expect(writeWithStyle('<HEAD><title>t</title></HEAD>{{content}}')).toBe(
			'<HEAD><title>t</title><style>x</style></HEAD>[C]',
		);
	});

	it('puts the element before the content when there is no head', () => {
		expect(writeWithStyle('<p>a</p>{{content}}<p>b</p>')).toBe(
			'<p>a</p><style>x</style>[C]<p>b</p>',
		);
	});

	it('leaves a text without head and content alone', () => {
		expect(writeWithStyle('<p>a</p>')).toBe('<p>a</p>');
	});
});
