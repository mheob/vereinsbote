/*
 * The accessibility warnings of a block template (Design 12). They do not keep a template from
 * being saved; the editor lists them next to the blocks, each with a jump to its block. Runs in
 * the browser, on Workers and on Node.
 */
import type { Block, ColumnBlock } from '@/mail/blocks/block-schema';
import type { InlineNode, Paragraph, TextDoc } from '@/mail/blocks/text-doc';

import { isVagueLinkText } from './vague-links';

/**
 * A warning: a heading that skips a level or starts below level 2, or a link text that says
 * nothing about the target.
 */
type Warning =
	| { readonly kind: 'headingOrder'; readonly blockId: string; readonly level: number }
	| { readonly kind: 'vagueLink'; readonly blockId: string; readonly text: string };

/** The level the first heading may have at most. */
const FIRST_HEADING_MAX_LEVEL = 2;

/**
 * Every block that is no columns block, in document order: a columns block's left side before
 * its right side.
 *
 * @param blocks The blocks.
 * @returns The blocks.
 */
function leaves(blocks: readonly Block[]): ColumnBlock[] {
	return blocks.flatMap((block) =>
		block.type === 'columns' ? [...block.left, ...block.right] : [block],
	);
}

/**
 * The warnings of the headings: the first must have level 1 or 2, each later one at most one
 * level more than the one before.
 *
 * @param blocks The blocks in document order.
 * @returns The warnings.
 */
function headingWarnings(blocks: readonly ColumnBlock[]): Warning[] {
	const warnings: Warning[] = [];
	let previous: number | null = null;
	for (const block of blocks) {
		if (block.type === 'heading') {
			const allowed = previous === null ? FIRST_HEADING_MAX_LEVEL : previous + 1;
			if (block.level > allowed) {
				warnings.push({ blockId: block.id, kind: 'headingOrder', level: block.level });
			}
			previous = block.level;
		}
	}
	return warnings;
}

/**
 * The target of a text node's link.
 *
 * @param node An inline node.
 * @returns The `href`, or null when the node is no linked text.
 */
function linkOf(node: InlineNode): string | null {
	if (node.type !== 'text') return null;
	return node.marks?.find((mark) => mark.type === 'link')?.attrs.href ?? null;
}

/**
 * The texts of the links of a paragraph. Neighbouring text nodes with the same target are one
 * link, whatever other marks they carry.
 *
 * @param paragraph The paragraph.
 * @returns The link texts in order.
 */
function linkTexts(paragraph: Paragraph): string[] {
	const texts: string[] = [];
	let href: string | null = null;
	for (const node of paragraph.content ?? []) {
		const target = linkOf(node);
		if (target === null || node.type !== 'text') {
			href = null;
		} else if (target === href) {
			texts.push(`${texts.pop() ?? ''}${node.text}`);
		} else {
			href = target;
			texts.push(node.text);
		}
	}
	return texts;
}

/**
 * The paragraphs of a text document, those of its lists included.
 *
 * @param doc The document.
 * @returns The paragraphs in order.
 */
function paragraphsOf(doc: TextDoc): Paragraph[] {
	return doc.content.flatMap((node) =>
		node.type === 'paragraph' ? [node] : node.content.flatMap((item) => item.content),
	);
}

/**
 * The label of a button as a link text; a label with a placeholder is not judged.
 *
 * @param label The label.
 * @returns The text, or null when the label holds a placeholder.
 */
function labelText(label: readonly InlineNode[]): string | null {
	let text = '';
	for (const node of label) {
		if (node.type !== 'text') return null;
		text += node.text;
	}
	return text;
}

/**
 * The link texts of a block that say nothing about the target.
 *
 * @param block The block.
 * @returns The warnings.
 */
function linkWarnings(block: ColumnBlock): Warning[] {
	let texts: string[] = [];
	if (block.type === 'text')
		texts = paragraphsOf(block.doc).flatMap((paragraph) => linkTexts(paragraph));
	if (block.type === 'button') {
		const label = labelText(block.label);
		texts = label === null ? [] : [label];
	}
	return texts
		.filter((text) => isVagueLinkText(text))
		.map((text): Warning => ({ blockId: block.id, kind: 'vagueLink', text }));
}

/**
 * The accessibility warnings of a template's blocks: headings that skip a level or start below
 * level 2, and link texts that say nothing about the target.
 *
 * @param blocks The blocks.
 * @returns The warnings, by the position of their block.
 */
function blockWarnings(blocks: readonly Block[]): Warning[] {
	const all = leaves(blocks);
	const headings = headingWarnings(all);
	const warnings: Warning[] = [];
	for (const block of all) {
		warnings.push(
			...headings.filter(({ blockId }) => blockId === block.id),
			...linkWarnings(block),
		);
	}
	return warnings;
}

export { blockWarnings };
export type { Warning };
