/*
 * The placeholder in Tiptap: an inline atom with its key and fallback, shown as a mark with the
 * translated name. A screen reader hears „Platzhalter“ before the name; the fallback is in the
 * title. The node's JSON (`{ type: 'placeholder', attrs: { key, fallback } }`) is what
 * `textDocSchema` stores.
 */
import { mergeAttributes, Node } from '@tiptap/core';

import type { Translate } from '@/i18n/translate';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';
import { placeholderLabel } from '@/server/templates/editor-placeholders';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import { describePlaceholder } from './describe-placeholder';

interface PlaceholderNodeOptions {
	/** The name of a placeholder key. */
	readonly label: (key: string) => string;
	/** What happens when the value is missing, in words. */
	readonly describe: (ref: Readonly<PlaceholderRef>) => string;
	/** The word a screen reader hears first, e.g. „Platzhalter“. */
	readonly prefix: string;
}

/** The look of the mark; the outline shows it is one piece. */
const CHIP_CLASS =
	'mx-0.5 inline-block rounded border border-dashed border-blue-700 bg-blue-50 px-1 font-semibold text-blue-900';

/**
 * The reference a node stands for.
 *
 * @param attrs The node's attributes.
 * @returns Key and fallback.
 */
function refOf(attrs: Readonly<Record<string, unknown>>): PlaceholderRef {
	const { fallback, key } = attrs;
	return {
		fallback: typeof fallback === 'string' ? fallback : null,
		key: typeof key === 'string' ? key : '',
	};
}

const PlaceholderNode = Node.create<PlaceholderNodeOptions>({
	addAttributes() {
		return {
			fallback: {
				default: null,
				parseHTML: (element) => element.dataset.fallback,
				renderHTML: (attributes) =>
					typeof attributes.fallback === 'string' ? { 'data-fallback': attributes.fallback } : {},
			},
			key: {
				default: '',
				parseHTML: (element) => element.dataset.key ?? '',
				renderHTML: (attributes) => ({
					'data-key': typeof attributes.key === 'string' ? attributes.key : '',
				}),
			},
		};
	},
	addOptions() {
		return { describe: (ref) => ref.key, label: (key) => key, prefix: '' };
	},
	atom: true,
	group: 'inline',
	inline: true,
	name: 'placeholder',
	parseHTML() {
		return [{ tag: 'span[data-placeholder]' }];
	},
	renderHTML({ HTMLAttributes, node }) {
		const ref = refOf(node.attrs);
		return [
			'span',
			mergeAttributes(HTMLAttributes, {
				class: CHIP_CLASS,
				'data-placeholder': '',
				title: this.options.describe(ref),
			}),
			['span', { class: 'sr-only' }, `${this.options.prefix} `],
			this.options.label(ref.key),
		];
	},
	renderText({ node }) {
		return this.options.label(refOf(node.attrs).key);
	},
	selectable: true,
});

/**
 * The options of the node for the editor of an area: names in the user's language, the fallback
 * in words.
 *
 * @param labels The placeholders the area offers (their names include those of custom fields).
 * @param t The translation function.
 * @returns The options.
 */
function placeholderNodeOptions(
	labels: readonly EditorPlaceholder[],
	t: Translate,
): PlaceholderNodeOptions {
	const label = (key: string): string => placeholderLabel(key, labels, t);
	return {
		describe: (ref) => describePlaceholder(ref, label(ref.key), t),
		label,
		prefix: t('editor.placeholder'),
	};
}

export { PlaceholderNode, placeholderNodeOptions, refOf };
export type { PlaceholderNodeOptions };
