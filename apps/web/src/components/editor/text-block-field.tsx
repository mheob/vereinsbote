/* oxlint-disable typescript/prefer-readonly-parameter-types -- Tiptap's editor and JSON content are mutable handles by design */
import { Extension } from '@tiptap/core';
import { Bold } from '@tiptap/extension-bold';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import type { Editor, Extensions } from '@tiptap/react';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';
import { isAllowedHref } from '@/mail/blocks/text-doc';
import type { TextDoc } from '@/mail/blocks/text-doc';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import { textDocFromJson, textDocToJson } from './editor-content';
import { PlaceholderNode, placeholderNodeOptions } from './placeholder-node';
import { TextToolbar } from './text-toolbar';
import { TiptapField } from './tiptap-field';

/** A link keeps only its address: the stored document has no `rel`, `target` or `class`. */
const AddressLink = Link.extend({
	addAttributes() {
		return {
			href: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('href') },
		};
	},
}).configure({
	HTMLAttributes: {},
	autolink: false,
	enableClickSelection: false,
	isAllowedUri: (url) => isAllowedHref(url),
	linkOnPaste: false,
	openOnClick: false,
});

/**
 * A list item holds paragraphs only (no nested lists), and Tab and Shift+Tab leave the editor
 * instead of indenting, so the keyboard never gets stuck.
 */
const FlatListItem = ListItem.extend({
	addKeyboardShortcuts() {
		return { Enter: () => this.editor.commands.splitListItem(this.name) };
	},
	content: 'paragraph+',
});

/**
 * The editor of a text block (Tiptap): bold, italic, links, lists, line breaks (Shift+Enter) and
 * placeholders. Undo and redo work inside the block.
 *
 * @param props The props.
 * @param props.label The visible label.
 * @param props.value The block's document.
 * @param props.onChange Called with the new document.
 * @param props.placeholders The placeholders the toolbar offers.
 * @param props.isReadOnly Whether the block is read-only.
 * @param props.error The message of a refusal, or null.
 * @param props.focusKey The key of the editor's problem jump.
 * @returns The field.
 */
export function TextBlockField({
	error,
	focusKey,
	isReadOnly,
	label,
	onChange,
	placeholders,
	value,
}: Readonly<{
	label: string;
	value: TextDoc;
	onChange: (value: TextDoc) => void;
	placeholders: readonly EditorPlaceholder[];
	isReadOnly: boolean;
	error: string | null;
	focusKey: string;
}>): ReactNode {
	const t = useT();
	const toolbarRef = useRef<HTMLDivElement>(null);
	// Created once: Tiptap builds its schema from the extensions when the editor starts.
	// oxlint-disable-next-line react/hook-use-state -- kept from the first render, never set: Tiptap builds its schema from it
	const [extensions] = useState<Extensions>(() => [
		Document,
		Paragraph,
		Text,
		Bold,
		Italic,
		AddressLink,
		BulletList,
		OrderedList,
		FlatListItem,
		HardBreak,
		PlaceholderNode.configure(placeholderNodeOptions(placeholders, t)),
		UndoRedo,
		Extension.create({
			addKeyboardShortcuts() {
				return {
					'Alt-F10': () => {
						toolbarRef.current?.querySelector<HTMLElement>('button')?.focus();
						return true;
					},
				};
			},
			name: 'toolbarShortcut',
		}),
	]);
	const before = useCallback(
		(editor: Editor) =>
			isReadOnly ? null : (
				<TextToolbar editor={editor} placeholders={placeholders} toolbarRef={toolbarRef} />
			),
		[isReadOnly, placeholders],
	);
	return (
		<TiptapField
			before={before}
			description={isReadOnly ? null : t('editor.toolbarHelp')}
			error={error}
			extensions={extensions}
			focusKey={focusKey}
			fromJson={textDocFromJson}
			isReadOnly={isReadOnly}
			label={label}
			multiline
			onChange={onChange}
			toJson={textDocToJson}
			value={value}
		/>
	);
}
