/* oxlint-disable no-script-url -- the tests feed such URLs on purpose to see them refused */
import { describe, expect, it } from 'vite-plus/test';

import { inlineContentSchema, isAllowedHref, textDocSchema } from './text-doc';

/**
 * Whether the text schema accepts a document.
 *
 * @param doc The document.
 * @returns Whether it passes.
 */
function acceptsDoc(doc: unknown): boolean {
	return textDocSchema.safeParse(doc).success;
}

/**
 * Whether the inline schema of headings and buttons accepts content.
 *
 * @param content The inline nodes.
 * @returns Whether it passes.
 */
function acceptsInline(content: unknown): boolean {
	return inlineContentSchema.safeParse(content).success;
}

/**
 * A document of one paragraph with one inline node.
 *
 * @param node The inline node.
 * @returns The document.
 */
function paragraphDoc(node: unknown): unknown {
	return { content: [{ content: [node], type: 'paragraph' }], type: 'doc' };
}

const linkDoc = (href: string): unknown =>
	paragraphDoc({ marks: [{ attrs: { href }, type: 'link' }], text: 'Mehr', type: 'text' });

const listItem = (text: string): unknown => ({
	content: [{ content: [{ text, type: 'text' }], type: 'paragraph' }],
	type: 'listItem',
});

const placeholderDoc = (key: string): unknown =>
	paragraphDoc({ attrs: { fallback: null, key }, type: 'placeholder' });

describe('the text schema', () => {
	it('accepts paragraphs, marks, breaks, placeholders and both lists', () => {
		const doc = {
			content: [
				{
					content: [
						{ marks: [{ type: 'bold' }, { type: 'italic' }], text: 'Hallo', type: 'text' },
						{ type: 'hardBreak' },
						{ attrs: { fallback: null, key: 'contact.firstName' }, type: 'placeholder' },
					],
					type: 'paragraph',
				},
				{ type: 'paragraph' },
				{ content: [listItem('eins')], type: 'bulletList' },
				{ content: [{ content: [{ type: 'paragraph' }], type: 'listItem' }], type: 'orderedList' },
			],
			type: 'doc',
		};
		expect(acceptsDoc(doc)).toBe(true);
	});

	it.each(['https://example.org/a?b=1', 'mailto:info@example.org', 'tel:+4912345'])(
		'accepts the link %s',
		(href) => {
			expect(acceptsDoc(linkDoc(href))).toBe(true);
		},
	);

	it.each([
		'javascript:x',
		' javascript:alert(1)',
		'java\tscript:alert(1)',
		'http://example.org',
		'data:text/html,x',
		'/relative',
		'',
	])('refuses the link %j', (href) => {
		expect(acceptsDoc(linkDoc(href))).toBe(false);
	});

	it.each([
		['a code block', { content: [{ content: [], type: 'codeBlock' }], type: 'doc' }],
		['an unknown inline node', paragraphDoc({ text: 'x', type: 'codeBlock' })],
		['an unknown mark', paragraphDoc({ marks: [{ type: 'underline' }], text: 'x', type: 'text' })],
		[
			'a link with more attributes',
			paragraphDoc({
				marks: [{ attrs: { href: 'https://example.org', target: '_blank' }, type: 'link' }],
				text: 'x',
				type: 'text',
			}),
		],
		['attributes of the document', { attrs: { textAlign: 'center' }, content: [], type: 'doc' }],
		['an empty text node', paragraphDoc({ text: '', type: 'text' })],
	])('refuses %s', (_name, doc) => {
		expect(acceptsDoc(doc)).toBe(false);
	});

	it.each(['', 'Contact', 'contact.first name', 'a}}{{b', 'contact.'])(
		'refuses the placeholder key %j',
		(key) => {
			expect(acceptsDoc(placeholderDoc(key))).toBe(false);
		},
	);
});

describe('the inline schema', () => {
	it('accepts text and placeholders', () => {
		const content = [
			{ text: 'Hallo ', type: 'text' },
			{ attrs: { fallback: 'du', key: 'contact.firstName' }, type: 'placeholder' },
		];
		expect(acceptsInline(content)).toBe(true);
	});

	it('refuses marks and line breaks', () => {
		expect(acceptsInline([{ marks: [{ type: 'bold' }], text: 'x', type: 'text' }])).toBe(false);
		expect(acceptsInline([{ type: 'hardBreak' }])).toBe(false);
	});
});

describe(isAllowedHref, () => {
	it('allows https, mailto and tel only', () => {
		expect(isAllowedHref('HTTPS://example.org')).toBe(true);
		expect(isAllowedHref('ftp://example.org')).toBe(false);
		expect(isAllowedHref('not a url')).toBe(false);
	});
});
