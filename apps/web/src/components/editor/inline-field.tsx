/* oxlint-disable typescript/prefer-readonly-parameter-types -- Tiptap's editor and JSON content are mutable handles by design */
import { Extension } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import type { Editor, Extensions } from '@tiptap/react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import { secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { InlineNode } from '@/mail/blocks/text-doc';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import { inlineFromJson, inlineToJson } from './editor-content';
import { PlaceholderDialog } from './placeholder-menu';
import { PlaceholderNode, placeholderNodeOptions } from './placeholder-node';
import { TiptapField } from './tiptap-field';

/** One paragraph, no more: the editor has one line. */
const OneLineDocument = Document.extend({ content: 'paragraph' });

/** Enter adds no paragraph and no line break in one line. */
const SingleLine = Extension.create({
	addKeyboardShortcuts() {
		return { Enter: () => true, 'Mod-Enter': () => true, 'Shift-Enter': () => true };
	},
	name: 'singleLine',
});

/**
 * The button beside the field that inserts a placeholder, and its dialog.
 *
 * @param props The props.
 * @param props.editor The field's editor.
 * @param props.label The label of the field, for the button's name.
 * @param props.placeholders The placeholders to offer.
 * @returns The button.
 */
function InsertPlaceholder({
	editor,
	label,
	placeholders,
}: Readonly<{
	editor: Editor;
	label: string;
	placeholders: readonly EditorPlaceholder[];
}>): ReactNode {
	const t = useT();
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => {
		setIsOpen(true);
	}, []);
	const insert = useCallback(
		(ref: Readonly<PlaceholderRef>) => {
			editor
				.chain()
				.insertContent({ attrs: { ...ref }, type: 'placeholder' })
				.run();
		},
		[editor],
	);
	return (
		<>
			<Button
				aria-label={t('editor.insertPlaceholderInto', { field: label })}
				className={secondaryButtonClass}
				onPress={open}
			>
				{t('editor.placeholder')}
			</Button>
			<PlaceholderDialog
				initial={null}
				isOpen={isOpen}
				onOpenChange={setIsOpen}
				onPick={insert}
				placeholders={placeholders}
			/>
		</>
	);
}

/**
 * A one-line editor for a heading, a button label, the subject, the preview text or a salutation
 * text: text without marks and placeholders, shown as marks. Enter does nothing. Without
 * placeholders to offer there is no button to insert one.
 *
 * @param props The props.
 * @param props.label The visible label.
 * @param props.value The content.
 * @param props.onChange Called with the new content.
 * @param props.placeholders The placeholders the button offers; none hides it.
 * @param props.labels The placeholders whose names the marks show (all the area offers).
 * @param props.isReadOnly Whether the field is read-only.
 * @param props.error The message of a refusal, or null.
 * @param props.description A hint below the field, or null.
 * @param props.focusKey The key of the editor's problem jump.
 * @returns The field.
 */
export function InlineField({
	description,
	error,
	focusKey,
	isReadOnly,
	label,
	labels,
	onChange,
	placeholders,
	value,
}: Readonly<{
	label: string;
	value: readonly InlineNode[];
	onChange: (value: readonly InlineNode[]) => void;
	placeholders: readonly EditorPlaceholder[];
	labels: readonly EditorPlaceholder[];
	isReadOnly: boolean;
	error: string | null;
	description: string | null;
	focusKey: string;
}>): ReactNode {
	const t = useT();
	// Created once: Tiptap builds its schema from the extensions when the editor starts.
	// oxlint-disable-next-line react/hook-use-state -- kept from the first render, never set
	const [extensions] = useState<Extensions>(() => [
		OneLineDocument,
		Paragraph,
		Text,
		PlaceholderNode.configure(placeholderNodeOptions(labels, t)),
		UndoRedo,
		SingleLine,
	]);
	const beside = useCallback(
		(editor: Editor) =>
			isReadOnly || placeholders.length === 0 ? null : (
				<InsertPlaceholder editor={editor} label={label} placeholders={placeholders} />
			),
		[isReadOnly, label, placeholders],
	);
	return (
		<TiptapField
			beside={beside}
			description={description}
			error={error}
			extensions={extensions}
			focusKey={focusKey}
			fromJson={inlineFromJson}
			isReadOnly={isReadOnly}
			label={label}
			multiline={false}
			onChange={onChange}
			toJson={inlineToJson}
			value={value}
		/>
	);
}
