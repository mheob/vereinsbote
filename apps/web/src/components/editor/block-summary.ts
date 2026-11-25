/*
 * The line a block shows in the editor's list, which is also its accessible name: the type and
 * a short summary of the content („Text: Wir laden …“). Placeholders appear with their names.
 */
import type { Translate } from '@/i18n/translate';
import type { Block } from '@/mail/blocks/block-schema';
import type { InlineNode, TextDoc } from '@/mail/blocks/text-doc';

/** The longest summary; longer ones end with an ellipsis. */
const MAX_SUMMARY_LENGTH = 60;
const WHITESPACE = /\s+/gu;

/**
 * The text of inline nodes, placeholders by their names.
 *
 * @param nodes The nodes.
 * @param label The name of a placeholder key.
 * @returns The text.
 */
function inlineText(
	nodes: readonly InlineNode[] | undefined,
	label: (key: string) => string,
): string {
	return (nodes ?? [])
		.map((node) => {
			if (node.type === 'text') return node.text;
			if (node.type === 'placeholder') return label(node.attrs.key);
			return ' ';
		})
		.join('');
}

/**
 * The text of a document, paragraphs and list items one after the other.
 *
 * @param doc The document.
 * @param label The name of a placeholder key.
 * @returns The text.
 */
function docText(doc: TextDoc, label: (key: string) => string): string {
	return doc.content
		.flatMap((node) =>
			node.type === 'paragraph'
				? [inlineText(node.content, label)]
				: node.content.flatMap((item) =>
						item.content.map((paragraph) => inlineText(paragraph.content, label)),
					),
		)
		.join(' ');
}

/**
 * A text on one line, shortened.
 *
 * @param text The text.
 * @returns The text with single spaces, at most `MAX_SUMMARY_LENGTH` characters.
 */
function shorten(text: string): string {
	const line = text.replaceAll(WHITESPACE, ' ').trim();
	return line.length > MAX_SUMMARY_LENGTH
		? `${line.slice(0, MAX_SUMMARY_LENGTH).trimEnd()} …`
		: line;
}

/**
 * What an image block shows in the list: its alt text, that it is decorative, or that it has no
 * image yet.
 *
 * @param block The image block.
 * @param t The translation function.
 * @returns The summary.
 */
function imageSummary(block: Extract<Block, { type: 'image' }>, t: Translate): string {
	if (block.mediaId === null) return t('editor.summary.noImage');
	if (block.decorative) return t('editor.summary.decorative');
	return block.alt;
}

/**
 * The summary of a block's content.
 *
 * @param block The block.
 * @param label The name of a placeholder key.
 * @param t The translation function.
 * @returns The summary; empty for a divider.
 */
function blockSummary(block: Block, label: (key: string) => string, t: Translate): string {
	if (block.type === 'divider') return '';
	switch (block.type) {
		case 'heading': {
			return shorten(inlineText(block.content, label));
		}
		case 'text': {
			return shorten(docText(block.doc, label));
		}
		case 'image': {
			return shorten(imageSummary(block, t));
		}
		case 'button': {
			return shorten(inlineText(block.label, label));
		}
		case 'spacer': {
			return t(`editor.size.${block.size}`);
		}
		case 'columns': {
			return t('editor.summary.columns', { left: block.left.length, right: block.right.length });
		}
		case 'placeholderLine': {
			return `${label(block.ref.key)}${block.suffix}`;
		}
		default: {
			return '';
		}
	}
}

/**
 * The line of a block in the list: its type and, if any, its summary.
 *
 * @param block The block.
 * @param label The name of a placeholder key.
 * @param t The translation function.
 * @returns „Typ: Zusammenfassung“, or the type alone; an empty heading or text says „leer“.
 */
function blockLine(block: Block, label: (key: string) => string, t: Translate): string {
	const type = t(`editor.blockType.${block.type}`);
	if (block.type === 'divider') return type;
	const summary = blockSummary(block, label, t);
	return `${type}: ${summary === '' ? t('editor.summary.empty') : summary}`;
}

export { blockLine, blockSummary };
