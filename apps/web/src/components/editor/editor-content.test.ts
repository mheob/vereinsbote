import { describe, expect, it } from 'vite-plus/test';

import { inlineContentSchema, textDocSchema } from '@/mail/blocks/text-doc';
import type { InlineNode } from '@/mail/blocks/text-doc';

import {
	inlineFromJson,
	inlineFromSyntax,
	inlineToJson,
	syntaxFromInline,
	textDocFromJson,
	textDocToJson,
} from './editor-content';

const firstName: InlineNode = {
	attrs: { fallback: null, key: 'contact.firstName' },
	type: 'placeholder',
};

describe(textDocFromJson, () => {
	it('keeps what a text block may hold', () => {
		const json = {
			content: [
				{
					content: [
						{ marks: [{ type: 'bold' }], text: 'Hallo ', type: 'text' },
						{ attrs: { fallback: '', key: 'contact.firstName' }, type: 'placeholder' },
						{ type: 'hardBreak' },
						{
							marks: [
								{ type: 'italic' },
								{ attrs: { href: 'mailto:info@example.org' }, type: 'link' },
							],
							text: 'Büro',
							type: 'text',
						},
					],
					type: 'paragraph',
				},
				{ type: 'paragraph' },
				{
					content: [
						{
							content: [{ content: [{ text: 'Eins', type: 'text' }], type: 'paragraph' }],
							type: 'listItem',
						},
					],
					type: 'bulletList',
				},
			],
			type: 'doc',
		};
		const doc = textDocFromJson(json);
		expect(doc).toStrictEqual(json);
		expect(textDocSchema.safeParse(doc).success).toBe(true);
	});

	it('drops the attributes Tiptap adds to lists and links', () => {
		const doc = textDocFromJson({
			content: [
				{
					attrs: { start: 1, type: null },
					content: [
						{
							attrs: {},
							content: [
								{
									attrs: { textAlign: null },
									content: [
										{
											marks: [
												{
													attrs: {
														class: null,
														href: 'https://example.org',
														rel: 'noopener',
														target: '_blank',
														title: null,
													},
													type: 'link',
												},
											],
											text: 'Programm',
											type: 'text',
										},
									],
									type: 'paragraph',
								},
							],
							type: 'listItem',
						},
					],
					type: 'orderedList',
				},
			],
			type: 'doc',
		});
		expect(doc).toStrictEqual({
			content: [
				{
					content: [
						{
							content: [
								{
									content: [
										{
											marks: [{ attrs: { href: 'https://example.org' }, type: 'link' }],
											text: 'Programm',
											type: 'text',
										},
									],
									type: 'paragraph',
								},
							],
							type: 'listItem',
						},
					],
					type: 'orderedList',
				},
			],
			type: 'doc',
		});
		expect(textDocSchema.safeParse(doc).success).toBe(true);
	});

	it('drops links a template may not use, unknown marks and unknown nodes', () => {
		const doc = textDocFromJson({
			content: [
				{
					content: [
						{
							marks: [
								{ attrs: { href: 'http://example.org' }, type: 'link' },
								{ type: 'underline' },
							],
							text: 'Seite',
							type: 'text',
						},
						{ text: '', type: 'text' },
						{ attrs: { src: 'x' }, type: 'image' },
						{ attrs: { key: 'contact.firstName' }, type: 'placeholder' },
					],
					type: 'paragraph',
				},
				{ content: [{ text: 'Zitat', type: 'text' }], type: 'blockquote' },
			],
			type: 'doc',
		});
		expect(doc).toStrictEqual({
			content: [{ content: [{ text: 'Seite', type: 'text' }, firstName], type: 'paragraph' }],
			type: 'doc',
		});
		expect(textDocSchema.safeParse(doc).success).toBe(true);
	});

	it('gives an empty document a paragraph', () => {
		expect(textDocFromJson({ type: 'doc' })).toStrictEqual({
			content: [{ type: 'paragraph' }],
			type: 'doc',
		});
	});
});

describe(textDocToJson, () => {
	it('gives Tiptap the stored document and reads back the same', () => {
		const doc = textDocFromJson({
			content: [
				{
					content: [
						{
							marks: [{ type: 'bold' }, { attrs: { href: 'tel:+491' }, type: 'link' }],
							text: 'Büro',
							type: 'text',
						},
						{ type: 'hardBreak' },
						firstName,
					],
					type: 'paragraph',
				},
				{ type: 'paragraph' },
				{
					content: [
						{
							content: [{ content: [{ text: 'Eins', type: 'text' }], type: 'paragraph' }],
							type: 'listItem',
						},
					],
					type: 'orderedList',
				},
			],
			type: 'doc',
		});
		const json = textDocToJson(doc);
		expect(json).toStrictEqual(doc);
		expect(textDocFromJson(json)).toStrictEqual(doc);
	});

	it('gives an empty document a paragraph', () => {
		expect(textDocToJson({ content: [], type: 'doc' })).toStrictEqual({
			content: [{ type: 'paragraph' }],
			type: 'doc',
		});
	});
});

describe('inlineFromJson and inlineToJson', () => {
	it('reads the text and the placeholders of a one-line editor', () => {
		const nodes = inlineFromJson({
			content: [
				{
					content: [
						{ text: 'Liebe ', type: 'text' },
						{ marks: [{ type: 'bold' }], text: 'Frau', type: 'text' },
						{ type: 'hardBreak' },
						{ attrs: { fallback: null, key: 'contact.firstName' }, type: 'placeholder' },
					],
					type: 'paragraph',
				},
				{ content: [{ text: 'und Gäste', type: 'text' }], type: 'paragraph' },
			],
			type: 'doc',
		});
		expect(nodes).toStrictEqual([
			{ text: 'Liebe Frau ', type: 'text' },
			firstName,
			{ text: ' und Gäste', type: 'text' },
		]);
		expect(inlineContentSchema.safeParse(nodes).success).toBe(true);
	});

	it('reads an empty editor as no content', () => {
		expect(inlineFromJson({ content: [{ type: 'paragraph' }], type: 'doc' })).toStrictEqual([]);
	});

	it('writes the content as a document with one paragraph', () => {
		expect(inlineToJson([{ text: 'Hallo ', type: 'text' }, firstName])).toStrictEqual({
			content: [{ content: [{ text: 'Hallo ', type: 'text' }, firstName], type: 'paragraph' }],
			type: 'doc',
		});
		expect(inlineToJson([])).toStrictEqual({ content: [{ type: 'paragraph' }], type: 'doc' });
	});
});

describe('inlineFromSyntax and syntaxFromInline', () => {
	it('turns placeholder syntax into nodes and back', () => {
		const text = String.raw`Liebe {{contact.firstName}}, hallo {{contact.lastName | "Gast \"X\""}}!`;
		const nodes = inlineFromSyntax(text);
		expect(nodes).toStrictEqual([
			{ text: 'Liebe ', type: 'text' },
			firstName,
			{ text: ', hallo ', type: 'text' },
			{ attrs: { fallback: 'Gast "X"', key: 'contact.lastName' }, type: 'placeholder' },
			{ text: '!', type: 'text' },
		]);
		expect(syntaxFromInline(nodes)).toBe(text);
	});

	it('keeps a text that does not parse as it is', () => {
		expect(inlineFromSyntax('Hallo {{ ')).toStrictEqual([{ text: 'Hallo {{ ', type: 'text' }]);
	});

	it('reads an empty text as no content', () => {
		expect(inlineFromSyntax('')).toStrictEqual([]);
		expect(syntaxFromInline([])).toBe('');
	});
});
