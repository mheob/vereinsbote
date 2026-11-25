import { describe, expect, it } from 'vite-plus/test';

import { blockListSchema } from '@/mail/blocks/block-schema';
import type { Block, ColumnsBlock } from '@/mail/blocks/block-schema';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { checkTemplateForSave } from '@/server/templates/testing';

import { BLOCK_TYPES, COLUMN_BLOCK_TYPES, duplicateBlock, newBlock } from './block-factory';

const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

const ALLOWED = {
	deliveredByKind: { member: new Set<never>(), partner: new Set<never>() },
	keys: new Set(['salutation', 'contact.firstName']),
	known: new Set(['salutation', 'contact.firstName']),
};

/**
 * A block that must be a columns block.
 *
 * @param block The block.
 * @returns The columns block.
 */
function columnsOf(block: Block): ColumnsBlock {
	if (block.type !== 'columns') throw new Error('The block is no columns block.');
	return block;
}

describe(newBlock, () => {
	it('makes a block of every type that passes the block schema', () => {
		expect(BLOCK_TYPES).toStrictEqual([
			'heading',
			'text',
			'image',
			'button',
			'divider',
			'spacer',
			'columns',
			'placeholderLine',
		]);
		for (const type of BLOCK_TYPES) {
			const block = newBlock(type);
			expect(block.type).toBe(type);
			expect(block.id).toMatch(UUID);
			expect(blockListSchema.safeParse([block]).success).toBe(true);
		}
	});

	it('offers every type but two columns inside a column', () => {
		expect(COLUMN_BLOCK_TYPES).toStrictEqual(BLOCK_TYPES.filter((type) => type !== 'columns'));
	});

	it('gives each block a new id', () => {
		expect(newBlock('text').id).not.toBe(newBlock('text').id);
	});

	it.each([
		['text', { doc: { content: [{ type: 'paragraph' }], type: 'doc' } }],
		['spacer', { size: 'medium' }],
		['button', { align: 'left', href: '', label: [] }],
		['heading', { content: [], level: 2 }],
		['image', { alt: '', decorative: false, href: null, mediaId: null }],
		['columns', { left: [], right: [] }],
		['placeholderLine', { ref: { fallback: null, key: 'salutation' }, suffix: '' }],
	] as const)('starts a %s block with the defaults of the plan', (type, expected) => {
		expect(newBlock(type)).toMatchObject(expected);
	});

	it('leaves an image without an image or an alt text to the save checks', () => {
		const image = newBlock('image');
		const problems = checkTemplateForSave(
			{
				body: { blocks: [image], kind: 'blocks', layout: { kind: 'standard' } },
				name: 'Sommerfest',
				preheader: '',
				salutationForm: 'du',
				salutationTexts: DEFAULT_SALUTATIONS.du,
				subject: 'Einladung',
			},
			ALLOWED,
			new Set(),
		);
		expect(problems).toStrictEqual([{ blockId: image.id, kind: 'altMissing' }]);
	});
});

describe(duplicateBlock, () => {
	it('copies a block under a new id', () => {
		const heading: Block = {
			content: [{ text: 'Programm', type: 'text' }],
			id: 'h',
			level: 2,
			type: 'heading',
		};
		const copy = duplicateBlock(heading);
		expect(copy).toStrictEqual({ ...heading, id: copy.id });
		expect(copy.id).toMatch(UUID);
	});

	it('gives the blocks of both columns new ids as well', () => {
		const columns: Block = {
			id: 'c',
			left: [{ id: 'l', type: 'divider' }],
			right: [{ id: 'r', size: 'small', type: 'spacer' }],
			type: 'columns',
		};
		const copy = columnsOf(duplicateBlock(columns));
		expect(copy.id).not.toBe('c');
		expect(copy.left).toStrictEqual([{ id: copy.left[0]?.id, type: 'divider' }]);
		expect(copy.right).toStrictEqual([{ id: copy.right[0]?.id, size: 'small', type: 'spacer' }]);
		expect(new Set([copy.id, copy.left[0]?.id, copy.right[0]?.id, 'c', 'l', 'r']).size).toBe(6);
		expect(blockListSchema.safeParse([columns, copy]).success).toBe(true);
	});
});
