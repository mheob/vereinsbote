import { useServerFn } from '@tanstack/react-start';
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	Dialog,
	DialogTrigger,
	FieldError,
	Heading,
	Input,
	Label,
	Modal,
	ModalOverlay,
	TextField,
} from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { inputClass, secondaryButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { useHydrated } from '@/components/use-hydrated';
import { submitImageName } from '@/functions/images';
import { useT } from '@/i18n/use-t';
import type { LibraryImage } from '@/server/media/library';

const MAX_NAME_LENGTH = 200;

type RenameState = Readonly<{ failure: 'invalid' }> | null;

/**
 * The rename form inside the open dialog; closes it after a result.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.image The image.
 * @param props.onChanged Called after a result that changes the list.
 * @param props.onClose Closes the dialog.
 * @returns The form.
 */
function Form({
	announce,
	image,
	onChanged,
	onClose,
}: Readonly<{
	announce: Announce;
	image: Readonly<LibraryImage>;
	onChanged: () => void;
	onClose: () => void;
}>): ReactNode {
	const t = useT();
	const rename = useServerFn(submitImageName);
	const inputRef = useRef<HTMLInputElement>(null);
	const [state, submitForm] = useActionState(
		async (_previous: RenameState, formData: FormData): Promise<RenameState> => {
			const raw = formData.get('name');
			const name = typeof raw === 'string' ? raw.trim() : '';
			const result = await settle(rename({ data: { id: image.id, name } }));
			if (result === undefined) return null;
			if (result === FAILED) {
				onClose();
				announce(t('auth.requestFailed'), 'alert');
				return null;
			}
			if (!result.ok && result.failure === 'invalid') return { failure: 'invalid' };
			onClose();
			if (result.ok) announce(t('images.renamed', { name }), 'status');
			else announce(t('images.gone'), 'alert');
			onChanged();
			return null;
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> =>
			state === null ? {} : { name: t('images.nameInvalid') },
		[state, t],
	);
	useEffect(() => {
		if (state !== null) inputRef.current?.focus();
	}, [state]);
	return (
		<PostForm
			className="flex flex-col gap-4"
			onSubmit={onSubmit}
			validationErrors={validationErrors}
		>
			<TextField
				className="flex flex-col gap-1"
				defaultValue={image.name}
				isRequired
				maxLength={MAX_NAME_LENGTH}
				name="name"
			>
				<Label className="font-semibold">{t('images.renameLabel')}</Label>
				<Input className={inputClass} ref={inputRef} />
				<FieldError className="text-sm text-red-700" />
			</TextField>
			<div className="flex justify-end gap-3">
				<Button className={secondaryButtonClass} slot="close">
					{t('images.cancel')}
				</Button>
				<SubmitButton>{t('images.renameSubmit')}</SubmitButton>
			</div>
		</PostForm>
	);
}

/**
 * The button „Umbenennen“ of an image and its dialog with one field, which holds the current
 * name. A refused name stays at the field; on success the dialog closes and the result is
 * announced.
 *
 * @param props The props.
 * @param props.announce Announces the result in the page's live region.
 * @param props.image The image.
 * @param props.onChanged Called after a rename (or when the image is gone) so the list reloads.
 * @returns The button with its dialog.
 */
export function RenameImageDialog({
	announce,
	image,
	onChanged,
}: Readonly<{
	announce: Announce;
	image: Readonly<LibraryImage>;
	onChanged: () => void;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const [isOpen, setIsOpen] = useState(false);
	const close = useCallback(() => {
		setIsOpen(false);
	}, []);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			<Button
				aria-label={t('images.renameAria', { name: image.name })}
				className={secondaryButtonClass}
				isPending={!hydrated}
			>
				{t('images.rename')}
			</Button>
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('images.renameTitle')}
						</Heading>
						<Form announce={announce} image={image} onChanged={onChanged} onClose={close} />
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}
