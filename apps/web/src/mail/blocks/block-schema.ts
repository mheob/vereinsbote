/*
 * The blocks of a template built in the click editor, and their strict validation. The schema
 * runs in the browser and on the server; the save checks (allowed placeholders, alt texts, empty
 * links) come on top of it.
 */
import { z } from 'zod';

import type { PlaceholderRef } from '@/mail/placeholders/syntax';

import { hrefSchema, inlineContentSchema, placeholderRefSchema, textDocSchema } from './text-doc';
import type { InlineNode, TextDoc } from './text-doc';

interface HeadingBlock {
	readonly id: string;
	readonly type: 'heading';
	readonly level: 1 | 2 | 3;
	readonly content: readonly InlineNode[];
}

interface TextBlock {
	readonly id: string;
	readonly type: 'text';
	readonly doc: TextDoc;
}

interface ImageBlock {
	readonly id: string;
	readonly type: 'image';
	/** Null until an image of the collection is chosen. */
	readonly mediaId: string | null;
	readonly alt: string;
	readonly decorative: boolean;
	readonly href: string | null;
}

interface ButtonBlock {
	readonly id: string;
	readonly type: 'button';
	readonly label: readonly InlineNode[];
	/** `''` until a link is set; the save checks report it. */
	readonly href: string;
	readonly align: 'left' | 'center';
}

interface DividerBlock {
	readonly id: string;
	readonly type: 'divider';
}

interface SpacerBlock {
	readonly id: string;
	readonly type: 'spacer';
	readonly size: 'small' | 'medium' | 'large';
}

interface PlaceholderLineBlock {
	readonly id: string;
	readonly type: 'placeholderLine';
	readonly ref: Readonly<PlaceholderRef>;
	/** Plain text right after the value, e.g. the comma of a salutation; may be empty. */
	readonly suffix: string;
}

/** A block that may stand in a column: every block but two columns. */
type ColumnBlock =
	| HeadingBlock
	| TextBlock
	| ImageBlock
	| ButtonBlock
	| DividerBlock
	| SpacerBlock
	| PlaceholderLineBlock;

interface ColumnsBlock {
	readonly id: string;
	readonly type: 'columns';
	readonly left: readonly ColumnBlock[];
	readonly right: readonly ColumnBlock[];
}

type Block = ColumnBlock | ColumnsBlock;

/** At most this many blocks in a template, the blocks in columns included. */
const MAX_BLOCKS = 100;
/** At most this size of a template as JSON: 256 KiB. */
const MAX_TEMPLATE_JSON_BYTES = 262_144;

const MAX_ID_LENGTH = 64;
const MAX_ALT_LENGTH = 500;
const MAX_SUFFIX_LENGTH = 10;
const MEDIA_ID = /^[\w-]{22}$/u;

const id = z.string().min(1).max(MAX_ID_LENGTH);
/** A button may be saved without a link; the save checks report it. */
const buttonHrefSchema = z.union([z.literal(''), hrefSchema]);

const columnBlockSchema = z.discriminatedUnion('type', [
	z.strictObject({
		content: inlineContentSchema,
		id,
		level: z.literal([1, 2, 3]),
		type: z.literal('heading'),
	}),
	z.strictObject({ doc: textDocSchema, id, type: z.literal('text') }),
	z.strictObject({
		alt: z.string().max(MAX_ALT_LENGTH),
		decorative: z.boolean(),
		href: hrefSchema.nullable(),
		id,
		mediaId: z.string().regex(MEDIA_ID).nullable(),
		type: z.literal('image'),
	}),
	z.strictObject({
		align: z.enum(['left', 'center']),
		href: buttonHrefSchema,
		id,
		label: inlineContentSchema,
		type: z.literal('button'),
	}),
	z.strictObject({ id, type: z.literal('divider') }),
	z.strictObject({ id, size: z.enum(['small', 'medium', 'large']), type: z.literal('spacer') }),
	z.strictObject({
		id,
		ref: placeholderRefSchema,
		suffix: z.string().max(MAX_SUFFIX_LENGTH),
		type: z.literal('placeholderLine'),
	}),
]);

const columnListSchema = z.array(columnBlockSchema).max(MAX_BLOCKS);

const blockSchema = z.discriminatedUnion('type', [
	...columnBlockSchema.options,
	z.strictObject({
		id,
		left: columnListSchema,
		right: columnListSchema,
		type: z.literal('columns'),
	}),
]);

/**
 * Every block with the blocks of its columns, in document order.
 *
 * @param blocks The blocks.
 * @returns The blocks, columns before their content.
 */
function flattenBlocks(blocks: readonly Block[]): (Block | ColumnBlock)[] {
	return blocks.flatMap((block) =>
		block.type === 'columns' ? [block, ...block.left, ...block.right] : [block],
	);
}

const blockListSchema: z.ZodType<readonly Block[]> = z
	.array(blockSchema)
	.max(MAX_BLOCKS)
	.superRefine((blocks, context) => {
		const all = flattenBlocks(blocks);
		if (all.length > MAX_BLOCKS) {
			context.addIssue({ code: 'custom', message: 'tooManyBlocks' });
		}
		if (new Set(all.map((block) => block.id)).size !== all.length) {
			context.addIssue({ code: 'custom', message: 'duplicateId' });
		}
	});

/**
 * The placeholders of inline content.
 *
 * @param content The inline nodes.
 * @returns The placeholder references.
 */
function inlineRefs(content: readonly InlineNode[] | undefined): PlaceholderRef[] {
	return (content ?? []).flatMap((node) =>
		node.type === 'placeholder' ? [{ fallback: node.attrs.fallback, key: node.attrs.key }] : [],
	);
}

/**
 * The placeholders of a text document.
 *
 * @param doc The document.
 * @returns The placeholder references in document order.
 */
function textDocRefs(doc: TextDoc): PlaceholderRef[] {
	return doc.content.flatMap((node) =>
		node.type === 'paragraph'
			? inlineRefs(node.content)
			: node.content.flatMap((item) =>
					item.content.flatMap((paragraph) => inlineRefs(paragraph.content)),
				),
	);
}

/**
 * The placeholders of one block (not of a column's content).
 *
 * @param block The block.
 * @returns The placeholder references.
 */
function blockRefs(block: Block): PlaceholderRef[] {
	if (block.type === 'heading') return inlineRefs(block.content);
	if (block.type === 'text') return textDocRefs(block.doc);
	if (block.type === 'button') return inlineRefs(block.label);
	if (block.type === 'placeholderLine')
		return [{ fallback: block.ref.fallback, key: block.ref.key }];
	return [];
}

/**
 * Every placeholder the blocks use, in document order, repeated ones included.
 *
 * @param blocks The blocks.
 * @returns The placeholder references.
 */
function collectPlaceholderRefs(blocks: readonly Block[]): PlaceholderRef[] {
	return flattenBlocks(blocks).flatMap((block) => blockRefs(block));
}

/**
 * The images the blocks show, each once.
 *
 * @param blocks The blocks.
 * @returns The media ids in document order.
 */
function collectMediaIds(blocks: readonly Block[]): string[] {
	const ids = flattenBlocks(blocks).flatMap((block) =>
		block.type === 'image' && block.mediaId !== null ? [block.mediaId] : [],
	);
	return [...new Set(ids)];
}

export {
	blockListSchema,
	collectMediaIds,
	collectPlaceholderRefs,
	MAX_BLOCKS,
	MAX_TEMPLATE_JSON_BYTES,
};
export type {
	Block,
	ButtonBlock,
	ColumnBlock,
	ColumnsBlock,
	DividerBlock,
	HeadingBlock,
	ImageBlock,
	PlaceholderLineBlock,
	SpacerBlock,
	TextBlock,
};
