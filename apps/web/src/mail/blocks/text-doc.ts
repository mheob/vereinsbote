/*
 * The content of a text block: a restricted Tiptap (ProseMirror) JSON document. The schema is
 * strict, so the server stores only nodes, marks and link schemes the mail renderer knows.
 * Placeholders are nodes of their own, never `{{…}}` in a text: a text node is shown as it is.
 */
import { z } from 'zod';

import { parsePlaceholders } from '@/mail/placeholders/syntax';

type Mark =
	| { readonly type: 'bold' }
	| { readonly type: 'italic' }
	| { readonly type: 'link'; readonly attrs: { readonly href: string } };

interface TextNode {
	readonly type: 'text';
	readonly text: string;
	readonly marks?: readonly Mark[];
}

interface PlaceholderNode {
	readonly type: 'placeholder';
	readonly attrs: { readonly key: string; readonly fallback: string | null };
}

type InlineNode = TextNode | { readonly type: 'hardBreak' } | PlaceholderNode;

interface Paragraph {
	readonly type: 'paragraph';
	readonly content?: readonly InlineNode[];
}

interface ListNode {
	readonly type: 'bulletList' | 'orderedList';
	readonly content: readonly {
		readonly type: 'listItem';
		readonly content: readonly Paragraph[];
	}[];
}

interface TextDoc {
	readonly type: 'doc';
	readonly content: readonly (Paragraph | ListNode)[];
}

/** Link schemes a template may use (Design 11). */
const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['https:', 'mailto:', 'tel:']);
const MAX_HREF_LENGTH = 2000;
const MAX_KEY_LENGTH = 100;
const MAX_FALLBACK_LENGTH = 200;

/**
 * Whether a link target is allowed in a template.
 *
 * @param value The `href`.
 * @returns True for an `https:`, `mailto:` or `tel:` URL.
 */
function isAllowedHref(value: string): boolean {
	return URL.canParse(value) && LINK_PROTOCOLS.has(new URL(value).protocol);
}

/**
 * Whether a text is a placeholder key, by the rules of the placeholder syntax.
 *
 * @param key The key.
 * @returns True when `{{key}}` reads as exactly this placeholder.
 */
function isPlaceholderKey(key: string): boolean {
	const parsed = parsePlaceholders(`{{${key}}}`);
	if (!parsed.ok || parsed.segments.length !== 1) return false;
	const [segment] = parsed.segments;
	return segment?.kind === 'placeholder' && segment.ref.key === key;
}

const hrefSchema = z.string().max(MAX_HREF_LENGTH).refine(isAllowedHref);

/** A placeholder: its key and its fallback (null: required, `''`: optional). */
const placeholderRefSchema = z.strictObject({
	fallback: z.string().max(MAX_FALLBACK_LENGTH).nullable(),
	key: z.string().max(MAX_KEY_LENGTH).refine(isPlaceholderKey),
});

const placeholderSchema = z.strictObject({
	attrs: placeholderRefSchema,
	type: z.literal('placeholder'),
});

const markSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('bold') }),
	z.strictObject({ type: z.literal('italic') }),
	z.strictObject({ attrs: z.strictObject({ href: hrefSchema }), type: z.literal('link') }),
]);

const plainTextSchema = z.strictObject({ text: z.string().min(1), type: z.literal('text') });

const inlineSchema = z.discriminatedUnion('type', [
	z.strictObject({
		marks: z.array(markSchema).optional(),
		text: z.string().min(1),
		type: z.literal('text'),
	}),
	z.strictObject({ type: z.literal('hardBreak') }),
	placeholderSchema,
]);

const paragraphSchema = z.strictObject({
	content: z.array(inlineSchema).optional(),
	type: z.literal('paragraph'),
});

const listItemSchema = z.strictObject({
	content: z.array(paragraphSchema),
	type: z.literal('listItem'),
});

const listSchema = z.strictObject({
	content: z.array(listItemSchema),
	type: z.enum(['bulletList', 'orderedList']),
});

const textDocSchema: z.ZodType<TextDoc> = z.strictObject({
	content: z.array(z.union([paragraphSchema, listSchema])),
	type: z.literal('doc'),
});

/** The content of a heading or a button label: text without marks, and placeholders. */
const inlineContentSchema: z.ZodType<readonly InlineNode[]> = z.array(
	z.discriminatedUnion('type', [plainTextSchema, placeholderSchema]),
);

export { hrefSchema, inlineContentSchema, isAllowedHref, placeholderRefSchema, textDocSchema };
export type { InlineNode, ListNode, Mark, Paragraph, PlaceholderNode, TextDoc, TextNode };
