import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useActionState, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { FieldError, Form, Input, Label, TextField } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { inputClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { submitCreateArea } from '@/functions/areas';
import { useT } from '@/i18n/use-t';
import { MAX_AREA_NAME_LENGTH } from '@/server/areas/form';

import { areaNameField, useAreaNameErrors, useAreaNameValidation } from './area-name';
import type { AreaFormState } from './area-name';

/**
 * Creates an area. A refused name shows its message at the field and gets the focus; after a
 * success the field is empty again and the table shows the area.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @returns The form.
 */
export function CreateAreaForm({ announce }: Readonly<{ announce: Announce }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const create = useServerFn(submitCreateArea);
	const headingId = useId();
	const formRef = useRef<HTMLFormElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [state, submitForm, isPending] = useActionState(
		async (_previous: AreaFormState, formData: FormData): Promise<AreaFormState> => {
			const name = areaNameField(formData);
			try {
				const result = await create({ data: { name } });
				if (!result.ok) return { failure: result.failure };
				formRef.current?.reset();
				await router.invalidate();
				announce(t('areas.created', { area: name }), 'status');
			} catch {
				announce(t('auth.requestFailed'), 'alert');
			}
			return null;
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	const validationErrors = useAreaNameErrors(state, t);
	const validateName = useAreaNameValidation(t);
	useEffect(() => {
		// A refused name gets the focus, so a screen reader reads it with its error.
		if (state !== null) inputRef.current?.focus();
	}, [state]);
	return (
		<section aria-labelledby={headingId} className="flex max-w-md flex-col gap-4">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('areas.createTitle')}
			</h2>
			<Form
				aria-labelledby={headingId}
				className="flex flex-col gap-4"
				onSubmit={onSubmit}
				ref={formRef}
				validationErrors={validationErrors}
			>
				<TextField
					autoComplete="off"
					className="flex flex-col gap-1"
					isRequired
					maxLength={MAX_AREA_NAME_LENGTH}
					name="name"
					validate={validateName}
				>
					<Label className="font-semibold">{t('areas.nameLabel')}</Label>
					<Input className={inputClass} ref={inputRef} />
					<FieldError className="text-sm text-red-700" />
				</TextField>
				<SubmitButton isPending={isPending}>{t('areas.createSubmit')}</SubmitButton>
			</Form>
		</section>
	);
}
