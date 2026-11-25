/* oxlint-disable typescript/prefer-readonly-parameter-types -- Tiptap's editor and JSON content are mutable handles by design */
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Button, ToggleButton, Toolbar } from 'react-aria-components';

import { secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import { LinkDialog } from './link-dialog';
import { PlaceholderDialog } from './placeholder-menu';

const toggleClass =
	'rounded-md border border-gray-600 px-2 py-1 font-semibold data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-gray-100 data-selected:border-blue-700 data-selected:bg-blue-700 data-selected:text-white';

/** The formatting of the selection, as the toolbar shows it. */
interface Formatting {
	readonly bold: boolean;
	readonly italic: boolean;
	readonly bulletList: boolean;
	readonly orderedList: boolean;
	readonly link: boolean;
}

/**
 * The toolbar of a text block: bold, italic, link, the two lists and placeholders. Alt+F10 in the
 * text moves here, Escape goes back; the arrow keys move between the buttons.
 *
 * @param props The props.
 * @param props.editor The block's editor.
 * @param props.placeholders The placeholders to offer.
 * @param props.toolbarRef Receives the toolbar's element, for Alt+F10.
 * @returns The toolbar.
 */
export function TextToolbar({
	editor,
	placeholders,
	toolbarRef,
}: Readonly<{
	editor: Editor;
	placeholders: readonly EditorPlaceholder[];
	toolbarRef: RefObject<HTMLDivElement | null>;
}>): ReactNode {
	const t = useT();
	const [linkOpen, setLinkOpen] = useState(false);
	const [placeholderOpen, setPlaceholderOpen] = useState(false);
	const state = useEditorState({
		editor,
		selector: ({ editor: current }): Formatting => ({
			bold: current.isActive('bold'),
			bulletList: current.isActive('bulletList'),
			italic: current.isActive('italic'),
			link: current.isActive('link'),
			orderedList: current.isActive('orderedList'),
		}),
	});
	const toggleBold = useCallback(() => {
		editor.chain().focus().toggleBold().run();
	}, [editor]);
	const toggleItalic = useCallback(() => {
		editor.chain().focus().toggleItalic().run();
	}, [editor]);
	const toggleBullets = useCallback(() => {
		editor.chain().focus().toggleBulletList().run();
	}, [editor]);
	const toggleNumbers = useCallback(() => {
		editor.chain().focus().toggleOrderedList().run();
	}, [editor]);
	const openLink = useCallback(() => {
		setLinkOpen(true);
	}, []);
	const openPlaceholder = useCallback(() => {
		setPlaceholderOpen(true);
	}, []);
	const insert = useCallback(
		(ref: PlaceholderRef) => {
			editor
				.chain()
				.insertContent({ attrs: { ...ref }, type: 'placeholder' })
				.run();
		},
		[editor],
	);
	// Escape in the toolbar goes back to the text (a native listener: the toolbar takes no key props).
	useEffect(() => {
		const toolbar = toolbarRef.current;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') editor.commands.focus();
		};
		toolbar?.addEventListener('keydown', onKeyDown);
		return () => {
			toolbar?.removeEventListener('keydown', onKeyDown);
		};
	}, [editor, toolbarRef]);
	return (
		<>
			<Toolbar aria-label={t('editor.toolbar')} className="flex flex-wrap gap-1" ref={toolbarRef}>
				<ToggleButton className={toggleClass} isSelected={state.bold} onChange={toggleBold}>
					{t('editor.bold')}
				</ToggleButton>
				<ToggleButton className={toggleClass} isSelected={state.italic} onChange={toggleItalic}>
					{t('editor.italic')}
				</ToggleButton>
				<ToggleButton className={toggleClass} isSelected={state.link} onChange={openLink}>
					{t('editor.link')}
				</ToggleButton>
				<ToggleButton
					className={toggleClass}
					isSelected={state.bulletList}
					onChange={toggleBullets}
				>
					{t('editor.bulletList')}
				</ToggleButton>
				<ToggleButton
					className={toggleClass}
					isSelected={state.orderedList}
					onChange={toggleNumbers}
				>
					{t('editor.orderedList')}
				</ToggleButton>
				{placeholders.length === 0 ? null : (
					<Button className={secondaryButtonClass} onPress={openPlaceholder}>
						{t('editor.insertPlaceholder')}
					</Button>
				)}
			</Toolbar>
			<LinkDialog editor={editor} isOpen={linkOpen} onOpenChange={setLinkOpen} />
			<PlaceholderDialog
				initial={null}
				isOpen={placeholderOpen}
				onOpenChange={setPlaceholderOpen}
				onPick={insert}
				placeholders={placeholders}
			/>
		</>
	);
}
