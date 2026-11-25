/* oxlint-disable typescript/prefer-readonly-parameter-types -- Tiptap's editor and JSON content are mutable handles by design */
/*
 * Between Tiptap's JSON and the content the mail schema stores. Tiptap adds attributes of its own
 * (a list's `start`, a link's `rel` and `target`) and could receive pasted marks or links a
 * template may not use; reading its JSON keeps only what `textDocSchema` and `inlineContentSchema`
 * allow, so the editor never holds a template the server would refuse. Subject, preview text and
 * salutation texts are stored with placeholder syntax; the one-line editors show them as nodes.
 */
import type { JSONContent } from '@tiptap/core';

import { isAllowedHref } from '@/mail/blocks/text-doc';
import type {
	InlineNode,
	ListNode,
	Mark,
	Paragraph,
	PlaceholderNode,
	TextDoc,
} from '@/mail/blocks/text-doc';
import { formatPlaceholder, parsePlaceholders } from '@/mail/placeholders/syntax';

/** The index of the last item, for `at`. */
const LAST = -1;

/** What stands for a line break or a paragraph break in one line. */
const SPACE = ' ';

/**
 * A mark a template may use.
 *
 * @param mark A mark of Tiptap's JSON.
 * @returns The mark without other attributes, or null when it is unknown or links elsewhere.
 */
function markOf(mark: Readonly<NonNullable<JSONContent['marks']>[number]>): Mark | null {
	if (mark.type === 'bold' || mark.type === 'italic') return { type: mark.type };
	if (mark.type !== 'link') return null;
	const href: unknown = mark.attrs?.href;
	return typeof href === 'string' && isAllowedHref(href) ? { attrs: { href }, type: 'link' } : null;
}

/**
 * A placeholder node with its key and fallback only.
 *
 * @param node A placeholder of Tiptap's JSON.
 * @returns The node, or null without a key.
 */
function placeholderOf(node: Readonly<JSONContent>): PlaceholderNode | null {
	const key: unknown = node.attrs?.key;
	const fallback: unknown = node.attrs?.fallback;
	if (typeof key !== 'string') return null;
	return {
		attrs: { fallback: typeof fallback === 'string' ? fallback : null, key },
		type: 'placeholder',
	};
}

/**
 * An inline node of a text block.
 *
 * @param node A node of Tiptap's JSON.
 * @returns The node, or null when it is empty or unknown.
 */
function inlineOf(node: Readonly<JSONContent>): InlineNode | null {
	if (node.type === 'hardBreak') return { type: 'hardBreak' };
	if (node.type === 'placeholder') return placeholderOf(node);
	if (node.type !== 'text' || typeof node.text !== 'string' || node.text === '') return null;
	const marks = (node.marks ?? []).flatMap((mark) => {
		const kept = markOf(mark);
		return kept === null ? [] : [kept];
	});
	return marks.length === 0
		? { text: node.text, type: 'text' }
		: { marks, text: node.text, type: 'text' };
}

/**
 * A paragraph with its known inline nodes.
 *
 * @param node A paragraph of Tiptap's JSON.
 * @returns The paragraph; without content when it is empty.
 */
function paragraphOf(node: Readonly<JSONContent>): Paragraph {
	const content = (node.content ?? []).flatMap((child) => {
		const inline = inlineOf(child);
		return inline === null ? [] : [inline];
	});
	return content.length === 0 ? { type: 'paragraph' } : { content, type: 'paragraph' };
}

/**
 * A list with its items, each made of paragraphs.
 *
 * @param node A list of Tiptap's JSON.
 * @param type Its type.
 * @returns The list.
 */
function listOf(node: Readonly<JSONContent>, type: ListNode['type']): ListNode {
	const content = (node.content ?? [])
		.filter((item) => item.type === 'listItem')
		.map((item) => ({
			content: (item.content ?? [])
				.filter((child) => child.type === 'paragraph')
				.map((child) => paragraphOf(child)),
			type: 'listItem' as const,
		}));
	return { content, type };
}

/**
 * The content of a text block from Tiptap's JSON.
 *
 * @param json The editor's document.
 * @returns The document as the block stores it; at least one paragraph.
 */
function textDocFromJson(json: Readonly<JSONContent>): TextDoc {
	const content = (json.content ?? []).flatMap((node): TextDoc['content'][number][] => {
		if (node.type === 'paragraph') return [paragraphOf(node)];
		if (node.type === 'bulletList' || node.type === 'orderedList') return [listOf(node, node.type)];
		return [];
	});
	return { content: content.length === 0 ? [{ type: 'paragraph' }] : content, type: 'doc' };
}

/**
 * Appends text to a list of inline nodes, joined with a text node at its end.
 *
 * @param nodes The nodes so far; changed.
 * @param text The text.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the list is built here on purpose
function appendText(nodes: InlineNode[], text: string): void {
	if (text === '') return;
	const last = nodes.at(LAST);
	if (last?.type === 'text') {
		nodes.pop();
		nodes.push({ text: last.text + text, type: 'text' });
	} else {
		nodes.push({ text, type: 'text' });
	}
}

/**
 * The content of a heading or a button label from a one-line editor: text without marks and
 * placeholders. A line break or a second paragraph becomes a space.
 *
 * @param json The editor's document.
 * @returns The inline nodes, neighbouring texts joined.
 */
function inlineFromJson(json: Readonly<JSONContent>): InlineNode[] {
	const nodes: InlineNode[] = [];
	for (const [index, paragraph] of (json.content ?? []).entries()) {
		if (index > 0) appendText(nodes, SPACE);
		for (const child of paragraph.content ?? []) {
			if (child.type === 'placeholder') {
				const placeholder = placeholderOf(child);
				if (placeholder !== null) nodes.push(placeholder);
			} else if (child.type === 'hardBreak') {
				appendText(nodes, SPACE);
			} else if (typeof child.text === 'string') {
				appendText(nodes, child.text);
			}
		}
	}
	return nodes;
}

/**
 * An inline node as Tiptap's JSON.
 *
 * @param node The node.
 * @returns The JSON.
 */
function inlineJson(node: InlineNode): JSONContent {
	if (node.type === 'hardBreak') return { type: 'hardBreak' };
	if (node.type === 'placeholder') return { attrs: { ...node.attrs }, type: 'placeholder' };
	if (node.marks === undefined) return { text: node.text, type: 'text' };
	const marks = node.marks.map((mark) =>
		mark.type === 'link' ? { attrs: { href: mark.attrs.href }, type: 'link' } : { type: mark.type },
	);
	return { marks, text: node.text, type: 'text' };
}

/**
 * A paragraph as Tiptap's JSON.
 *
 * @param paragraph The paragraph.
 * @returns The JSON.
 */
function paragraphJson(paragraph: Paragraph): JSONContent {
	return paragraph.content === undefined || paragraph.content.length === 0
		? { type: 'paragraph' }
		: { content: paragraph.content.map((node) => inlineJson(node)), type: 'paragraph' };
}

/**
 * The content of a text block as Tiptap's JSON.
 *
 * @param doc The document the block stores.
 * @returns The editor's document.
 */
function textDocToJson(doc: TextDoc): JSONContent {
	const content = doc.content.map((node) =>
		node.type === 'paragraph'
			? paragraphJson(node)
			: {
					content: node.content.map((item) => ({
						content: item.content.map((paragraph) => paragraphJson(paragraph)),
						type: 'listItem',
					})),
					type: node.type,
				},
	);
	return { content: content.length === 0 ? [{ type: 'paragraph' }] : content, type: 'doc' };
}

/**
 * The document of a one-line editor.
 *
 * @param nodes The inline nodes.
 * @returns A document with one paragraph.
 */
function inlineToJson(nodes: readonly InlineNode[]): JSONContent {
	return { content: [paragraphJson({ content: nodes, type: 'paragraph' })], type: 'doc' };
}

/**
 * The inline nodes of a text with placeholder syntax. A text that does not parse stays one text,
 * as it is; the save checks report it.
 *
 * @param text The text.
 * @returns The nodes.
 */
function inlineFromSyntax(text: string): InlineNode[] {
	const parsed = parsePlaceholders(text);
	if (!parsed.ok) return text === '' ? [] : [{ text, type: 'text' }];
	const nodes: InlineNode[] = [];
	for (const segment of parsed.segments) {
		if (segment.kind === 'text') appendText(nodes, segment.value);
		else nodes.push({ attrs: { ...segment.ref }, type: 'placeholder' });
	}
	return nodes;
}

/**
 * A text with placeholder syntax from inline nodes.
 *
 * @param nodes The nodes.
 * @returns The text.
 */
function syntaxFromInline(nodes: readonly InlineNode[]): string {
	return nodes
		.map((node) => {
			if (node.type === 'text') return node.text;
			if (node.type === 'placeholder') return formatPlaceholder(node.attrs);
			return SPACE;
		})
		.join('');
}

export {
	inlineFromJson,
	inlineFromSyntax,
	inlineToJson,
	syntaxFromInline,
	textDocFromJson,
	textDocToJson,
};
