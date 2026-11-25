/*
 * Placeholders while rendering: the compiler hands the renderer a function that gives the text a
 * placeholder stands for, a brand value or a slot marker.
 */
import type { InlineNode } from '@/mail/blocks/text-doc';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';

/** The text a placeholder stands for while rendering: a brand value or a slot marker. */
type ResolvePlaceholder = (ref: Readonly<PlaceholderRef>) => string;

/**
 * The text of a heading or a button label: its text nodes and resolved placeholders.
 *
 * @param nodes The inline nodes; a line break becomes a space.
 * @param resolve The placeholder values.
 * @returns The text.
 */
function inlineText(nodes: readonly InlineNode[], resolve: ResolvePlaceholder): string {
	return nodes
		.map((node) => {
			if (node.type === 'text') return node.text;
			if (node.type === 'placeholder') return resolve(node.attrs);
			return ' ';
		})
		.join('');
}

export { inlineText };
export type { ResolvePlaceholder };
