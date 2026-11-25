import { describe, expect, it } from 'vite-plus/test';

import type { Block, ColumnBlock } from '@/mail/blocks/block-schema';
import type { InlineNode, TextDoc } from '@/mail/blocks/text-doc';

import { blockWarnings } from './block-checks';

const heading = (id: string, level: 1 | 2 | 3): ColumnBlock => ({
	content: [{ text: `Ebene ${String(level)}`, type: 'text' }],
	id,
	level,
	type: 'heading',
});

const linkText = (text: string, href = 'https://example.org/programm'): InlineNode => ({
	marks: [{ attrs: { href }, type: 'link' }],
	text,
	type: 'text',
});

const textBlock = (id: string, content: readonly InlineNode[]): ColumnBlock => {
	const doc: TextDoc = { content: [{ content, type: 'paragraph' }], type: 'doc' };
	return { doc, id, type: 'text' };
};

const button = (id: string, label: readonly InlineNode[]): ColumnBlock => ({
	align: 'left',
	href: 'https://example.org/anmeldung',
	id,
	label,
	type: 'button',
});

describe('blockWarnings: heading order', () => {
	it('accepts headings that start at level 1 or 2 and skip no level', () => {
		expect(blockWarnings([heading('a', 1), heading('b', 2), heading('c', 3)])).toStrictEqual([]);
		expect(blockWarnings([heading('a', 2), heading('b', 3), heading('c', 2)])).toStrictEqual([]);
		expect(blockWarnings([heading('a', 1), heading('b', 2), heading('c', 1)])).toStrictEqual([]);
	});

	it('warns when a level is skipped', () => {
		expect(blockWarnings([heading('a', 1), heading('b', 3)])).toStrictEqual([
			{ blockId: 'b', kind: 'headingOrder', level: 3 },
		]);
		expect(blockWarnings([heading('a', 1), heading('b', 3), heading('c', 1)])).toStrictEqual([
			{ blockId: 'b', kind: 'headingOrder', level: 3 },
		]);
	});

	it('warns when the first heading has level 3', () => {
		expect(blockWarnings([heading('a', 3), heading('b', 3)])).toStrictEqual([
			{ blockId: 'a', kind: 'headingOrder', level: 3 },
		]);
	});

	it('follows the document order through both columns', () => {
		const columns: Block = {
			id: 'cols',
			left: [heading('left', 2)],
			right: [heading('right', 3)],
			type: 'columns',
		};
		expect(blockWarnings([heading('a', 1), columns, heading('b', 3)])).toStrictEqual([]);
		const skipping: Block = { ...columns, left: [heading('left', 3)], right: [] };
		expect(blockWarnings([heading('a', 1), skipping])).toStrictEqual([
			{ blockId: 'left', kind: 'headingOrder', level: 3 },
		]);
	});
});

describe('blockWarnings: vague link texts', () => {
	it('warns about a link that says „Hier klicken!“', () => {
		const blocks = [
			textBlock('t', [{ text: 'Zum Programm: ', type: 'text' }, linkText('Hier klicken!')]),
		];
		expect(blockWarnings(blocks)).toStrictEqual([
			{ blockId: 't', kind: 'vagueLink', text: 'Hier klicken!' },
		]);
	});

	it('accepts a link that names its target', () => {
		const block = textBlock('t', [linkText('Programm ansehen')]);
		expect(blockWarnings([block])).toStrictEqual([]);
	});

	it('reads a link across text nodes with other marks as one text', () => {
		const bold: InlineNode = {
			marks: [{ type: 'bold' }, { attrs: { href: 'https://example.org/programm' }, type: 'link' }],
			text: 'klicken',
			type: 'text',
		};
		const blocks = [textBlock('t', [linkText('hier '), bold, { text: ' jetzt', type: 'text' }])];
		expect(blockWarnings(blocks)).toStrictEqual([
			{ blockId: 't', kind: 'vagueLink', text: 'hier klicken' },
		]);
	});

	it('separates adjacent links to different targets', () => {
		const blocks = [
			textBlock('t', [linkText('Programm', 'https://example.org/a'), linkText('mehr', 'tel:+491')]),
		];
		expect(blockWarnings(blocks)).toStrictEqual([
			{ blockId: 't', kind: 'vagueLink', text: 'mehr' },
		]);
	});

	it('checks links in lists and bare addresses', () => {
		const doc: TextDoc = {
			content: [
				{
					content: [
						{
							content: [{ content: [linkText('www.example.org')], type: 'paragraph' }],
							type: 'listItem',
						},
					],
					type: 'bulletList',
				},
			],
			type: 'doc',
		};
		expect(blockWarnings([{ doc, id: 'list', type: 'text' }])).toStrictEqual([
			{ blockId: 'list', kind: 'vagueLink', text: 'www.example.org' },
		]);
	});

	it('checks the label of a button unless it holds a placeholder', () => {
		expect(blockWarnings([button('b', [{ text: 'Mehr', type: 'text' }])])).toStrictEqual([
			{ blockId: 'b', kind: 'vagueLink', text: 'Mehr' },
		]);
		expect(blockWarnings([button('b', [{ text: 'Zur Anmeldung', type: 'text' }])])).toStrictEqual(
			[],
		);
		const withPlaceholder: readonly InlineNode[] = [
			{ text: 'Mehr für ', type: 'text' },
			{ attrs: { fallback: '', key: 'contact.firstName' }, type: 'placeholder' },
		];
		expect(blockWarnings([button('b', withPlaceholder)])).toStrictEqual([]);
	});

	it('lists the warnings in document order', () => {
		const blocks = [
			heading('h3', 3),
			textBlock('t', [linkText('Link')]),
			{
				id: 'cols',
				left: [button('b', [{ text: 'weiter', type: 'text' }])],
				right: [],
				type: 'columns',
			} as Block,
		];
		expect(blockWarnings(blocks)).toStrictEqual([
			{ blockId: 'h3', kind: 'headingOrder', level: 3 },
			{ blockId: 't', kind: 'vagueLink', text: 'Link' },
			{ blockId: 'b', kind: 'vagueLink', text: 'weiter' },
		]);
	});
});
