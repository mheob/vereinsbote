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
import type { TemplateArea } from '@/functions/templates';
import { submitDuplicate } from '@/functions/templates';
import { useT } from '@/i18n/use-t';
import { MAX_TEMPLATE_NAME_LENGTH } from '@/server/templates/save-checks';

import { AreaSelect } from './area-select';

/** What the form refused: the name is taken, or the copy cannot be made as asked. */
type DuplicateState =
	| Readonly<{ failure: 'nameTaken' | 'storageMissing' }>
	| Readonly<{ failure: 'forbiddenPlaceholders'; keys: readonly string[] }>
	| null;

/** The template to copy. */
type SourceTemplate = Readonly<{ id: string; name: string; areaId: string }>;

/**
 * The form inside the open dialog: the area of the copy and its name. A refusal stays in the
 * dialog, at the field or as a message; the copy opens on success.
 *
 * @param props The props.
 * @param props.announce Announces what the dialog cannot say itself (a failed request).
 * @param props.areas The areas the user may edit.
 * @param props.onClose Closes the dialog.
 * @param props.onCopied Called with the id and name of the copy.
 * @param props.onGone Called when the template or the target area is gone.
 * @param props.source The template to copy.
 * @returns The form.
 */
function Form({
	announce,
	areas,
	onClose,
	onCopied,
	onGone,
	source,
}: Readonly<{
	announce: Announce;
	areas: readonly TemplateArea[];
	onClose: () => void;
	onCopied: (id: string, name: string) => void;
	onGone: () => void;
	source: SourceTemplate;
}>): ReactNode {
	const t = useT();
	const duplicate = useServerFn(submitDuplicate);
	const inputRef = useRef<HTMLInputElement>(null);
	// The own area first, if it can be edited; otherwise the first area the user may edit.
	const [areaId, setAreaId] = useState(
		areas.find(({ id }) => id === source.areaId)?.id ?? areas[0]?.id ?? '',
	);
	const [state, submitForm] = useActionState(
		async (_previous: DuplicateState, formData: FormData): Promise<DuplicateState> => {
			const raw = formData.get('name');
			const name = typeof raw === 'string' ? raw.trim() : '';
			const result = await settle(
				duplicate({ data: { id: source.id, name, targetAreaId: areaId } }),
			);
			if (result === undefined) return null;
			if (result === FAILED) {
				onClose();
				announce(t('auth.requestFailed'), 'alert');
				return null;
			}
			if (result.ok) {
				onClose();
				onCopied(result.id, name);
				return null;
			}
			if (result.failure === 'gone') {
				onClose();
				announce(t('templates.gone'), 'alert');
				onGone();
				return null;
			}
			return result.failure === 'forbiddenPlaceholders'
				? { failure: result.failure, keys: result.keys }
				: { failure: result.failure };
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> =>
			state?.failure === 'nameTaken' ? { name: t('templates.nameTaken') } : {},
		[state, t],
	);
	useEffect(() => {
		if (state?.failure === 'nameTaken') inputRef.current?.focus();
	}, [state]);
	return (
		<PostForm
			className="flex flex-col gap-4"
			onSubmit={onSubmit}
			validationErrors={validationErrors}
		>
			<AreaSelect
				areas={areas}
				label={t('templates.duplicateTarget')}
				onChange={setAreaId}
				value={areaId}
			/>
			<TextField
				className="flex flex-col gap-1"
				defaultValue={t('templates.duplicateNameDefault', { name: source.name }).slice(
					0,
					MAX_TEMPLATE_NAME_LENGTH,
				)}
				isRequired
				maxLength={MAX_TEMPLATE_NAME_LENGTH}
				name="name"
			>
				<Label className="font-semibold">{t('templates.duplicateName')}</Label>
				<Input className={inputClass} ref={inputRef} />
				<FieldError className="text-sm text-red-700" />
			</TextField>
			{state?.failure === 'forbiddenPlaceholders' ? (
				<p className="text-red-700" role="alert">
					{t('templates.duplicateForbidden', { keys: state.keys.join(', ') })}
				</p>
			) : null}
			{state?.failure === 'storageMissing' ? (
				<p className="text-red-700" role="alert">
					{t('templates.duplicateStorage')}
				</p>
			) : null}
			<div className="flex justify-end gap-3">
				<Button className={secondaryButtonClass} slot="close">
					{t('templates.cancel')}
				</Button>
				<SubmitButton>{t('templates.duplicateSubmit')}</SubmitButton>
			</div>
		</PostForm>
	);
}

/**
 * The button „Duplizieren“ of a template and its dialog: the area of the copy (only areas the user
 * may edit) and the name of the copy. The copy opens afterwards; the notice goes there in the
 * history state.
 *
 * @param props The props.
 * @param props.announce Announces a failure in the page's live region.
 * @param props.areas The areas the user may edit; the button is not shown without one.
 * @param props.label The accessible name of the button; the visible one is „Duplizieren“.
 * @param props.onCopied Called with the id and name of the copy.
 * @param props.onGone Called when the template or the area is gone, so the page loads anew.
 * @param props.source The template to copy.
 * @returns The button with its dialog.
 */
export function DuplicateDialog({
	announce,
	areas,
	label,
	onCopied,
	onGone,
	source,
}: Readonly<{
	announce: Announce;
	areas: readonly TemplateArea[];
	label: string;
	onCopied: (id: string, name: string) => void;
	onGone: () => void;
	source: SourceTemplate;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const [isOpen, setIsOpen] = useState(false);
	const close = useCallback(() => {
		setIsOpen(false);
	}, []);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			<Button aria-label={label} className={secondaryButtonClass} isPending={!hydrated}>
				{t('templates.duplicate')}
			</Button>
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('templates.duplicateTitle', { name: source.name })}
						</Heading>
						<Form
							announce={announce}
							areas={areas}
							onClose={close}
							onCopied={onCopied}
							onGone={onGone}
							source={source}
						/>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}
