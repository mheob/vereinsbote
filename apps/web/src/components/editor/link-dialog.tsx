/* oxlint-disable typescript/prefer-readonly-parameter-types -- Tiptap's editor and JSON content are mutable handles by design */
import type { Editor } from '@tiptap/react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	Dialog,
	FieldError,
	Heading,
	Input,
	Label,
	Modal,
	ModalOverlay,
	Text,
	TextField,
} from 'react-aria-components';

import { PostForm } from '@/components/post-form';
import { dangerButtonClass, inputClass, secondaryButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import type { SubmitHandler } from '@/components/use-form-submit';
import { useT } from '@/i18n/use-t';
import { isAllowedHref } from '@/mail/blocks/text-doc';

/** The longest link the schema allows. */
const MAX_HREF_LENGTH = 2000;

/**
 * The form of the open dialog: the address and, without selected text, the link text.
 *
 * @param props The props.
 * @param props.editor The text block's editor.
 * @param props.onDone Closes the dialog.
 * @returns The form.
 */
function LinkForm({ editor, onDone }: Readonly<{ editor: Editor; onDone: () => void }>): ReactNode {
	const t = useT();
	const isLink = editor.isActive('link');
	const needsText = editor.state.selection.empty && !isLink;
	const [href, setHref] = useState(() => {
		const current: unknown = editor.getAttributes('link').href;
		return typeof current === 'string' ? current : 'https://';
	});
	const [text, setText] = useState('');
	const [invalid, setInvalid] = useState(false);
	const submit = useCallback<SubmitHandler>(
		(event) => {
			event.preventDefault();
			const target = href.trim();
			if (!isAllowedHref(target)) {
				setInvalid(true);
				return;
			}
			const link = { attrs: { href: target }, type: 'link' };
			if (needsText) {
				const label = text.trim() === '' ? target : text.trim();
				editor
					.chain()
					.insertContent({ marks: [link], text: label, type: 'text' })
					.run();
			} else {
				editor.chain().extendMarkRange('link').setLink({ href: target }).run();
			}
			onDone();
		},
		[editor, href, needsText, onDone, text],
	);
	const remove = useCallback(() => {
		editor.chain().extendMarkRange('link').unsetLink().run();
		onDone();
	}, [editor, onDone]);
	const changeHref = useCallback((value: string) => {
		setHref(value);
		setInvalid(false);
	}, []);
	return (
		<PostForm className="flex flex-col gap-4" onSubmit={submit}>
			<TextField
				autoComplete="off"
				className="flex flex-col gap-1"
				isInvalid={invalid}
				isRequired
				maxLength={MAX_HREF_LENGTH}
				onChange={changeHref}
				type="url"
				validationBehavior="aria"
				value={href}
			>
				<Label className="font-semibold">{t('editor.href')}</Label>
				<Input className={inputClass} />
				<Text className="text-sm text-gray-700" slot="description">
					{t('editor.hrefHelp')}
				</Text>
				<FieldError className="text-sm text-red-700">{t('editor.hrefInvalid')}</FieldError>
			</TextField>
			{needsText ? (
				<TextField
					autoComplete="off"
					className="flex flex-col gap-1"
					onChange={setText}
					value={text}
				>
					<Label className="font-semibold">{t('editor.linkText')}</Label>
					<Input className={inputClass} />
					<Text className="text-sm text-gray-700" slot="description">
						{t('editor.linkTextHelp')}
					</Text>
				</TextField>
			) : null}
			<div className="flex flex-wrap justify-end gap-3">
				{isLink ? (
					<Button className={dangerButtonClass} onPress={remove}>
						{t('editor.linkRemove')}
					</Button>
				) : null}
				<Button className={secondaryButtonClass} slot="close">
					{t('templates.cancel')}
				</Button>
				<SubmitButton>{t('editor.linkApply')}</SubmitButton>
			</div>
		</PostForm>
	);
}

/**
 * The dialog that sets, changes or removes the link of the selected text (`https:`, `mailto:` or
 * `tel:`). Without selected text it inserts a linked text.
 *
 * @param props The props.
 * @param props.editor The text block's editor.
 * @param props.isOpen Whether the dialog is open.
 * @param props.onOpenChange Called when the dialog wants to open or close.
 * @returns The dialog.
 */
export function LinkDialog({
	editor,
	isOpen,
	onOpenChange,
}: Readonly<{
	editor: Editor;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
}>): ReactNode {
	const t = useT();
	const close = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);
	return (
		<ModalOverlay
			className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
			isDismissable
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
				<Dialog className="flex flex-col gap-4 outline-none">
					<Heading className="text-xl font-bold" slot="title">
						{t('editor.linkTitle')}
					</Heading>
					<LinkForm editor={editor} onDone={close} />
				</Dialog>
			</Modal>
		</ModalOverlay>
	);
}
