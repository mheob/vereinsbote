/*
 * New blocks for the editor: every type with the defaults of the plan, and copies under new ids.
 * A new block passes the block schema; what it still lacks (an image, an alt text, a link) is the
 * save checks' business, so the editor can show it at the field.
 */
import type { Block, ColumnBlock } from '@/mail/blocks/block-schema';

type BlockType = Block['type'];
type ColumnBlockType = ColumnBlock['type'];

/** Every type, in the order of the menu „Baustein hinzufügen“. */
const BLOCK_TYPES: readonly BlockType[] = [
	'heading',
	'text',
	'image',
	'button',
	'divider',
	'spacer',
	'columns',
	'placeholderLine',
];

/** The types a column may hold: every type but two columns. */
const COLUMN_BLOCK_TYPES: readonly ColumnBlockType[] = BLOCK_TYPES.filter(
	(type): type is ColumnBlockType => type !== 'columns',
);

/**
 * A new block of a type that may stand in a column.
 *
 * @param type The type.
 * @param id The id of the block.
 * @returns The block.
 */
function newColumnBlock(type: ColumnBlockType, id: string): ColumnBlock {
	switch (type) {
		case 'heading': {
			return { content: [], id, level: 2, type };
		}
		case 'text': {
			return { doc: { content: [{ type: 'paragraph' }], type: 'doc' }, id, type };
		}
		case 'image': {
			return { alt: '', decorative: false, href: null, id, mediaId: null, type };
		}
		case 'button': {
			return { align: 'left', href: '', id, label: [], type };
		}
		case 'divider': {
			return { id, type };
		}
		case 'spacer': {
			return { id, size: 'medium', type };
		}
		case 'placeholderLine': {
			return { id, ref: { fallback: null, key: 'salutation' }, suffix: '', type };
		}
		default: {
			throw new TypeError('Unknown block type.');
		}
	}
}

/**
 * A new block with a new id. Text starts with an empty paragraph, a spacer is medium, a button is
 * left-aligned without a link, a placeholder line shows the salutation.
 *
 * @param type The type.
 * @returns The block.
 */
function newBlock(type: BlockType): Block {
	const id = crypto.randomUUID();
	return type === 'columns' ? { id, left: [], right: [], type } : newColumnBlock(type, id);
}

/**
 * A copy of one block under a new id.
 *
 * @param source The block.
 * @returns The copy.
 */
const copy = <T extends Block>(source: T): T => ({ ...source, id: crypto.randomUUID() });

/**
 * A copy of a block under a new id; the blocks of a columns block get new ids as well.
 *
 * @param block The block.
 * @returns The copy.
 */
function duplicateBlock(block: Block): Block {
	if (block.type !== 'columns') return copy(block);
	return { ...copy(block), left: block.left.map(copy), right: block.right.map(copy) };
}

export { BLOCK_TYPES, COLUMN_BLOCK_TYPES, duplicateBlock, newBlock };
export type { BlockType, ColumnBlockType };
