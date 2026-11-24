import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useActionState, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { ButtonContext, FieldError, Input, Label, NumberField, Text } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { inputClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { submitStaleImportWeeks } from '@/functions/contact-settings';
import { useT } from '@/i18n/use-t';
import {
	isValidStaleImportWeeks,
	MAX_STALE_IMPORT_WEEKS,
	MIN_STALE_IMPORT_WEEKS,
} from '@/server/contacts/stale-weeks';

/** Whole weeks only: the field takes no decimal separator and shows no grouping. */
const WEEK_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };

/** Whether the server refused the last submission; a new object per refusal. */
type WeeksState = Readonly<{ refused: true }> | null;

/**
 * Reads the weeks of the submitted form.
 *
 * @param formData The submitted form.
 * @returns The weeks, NaN when the field is empty.
 */
function weeksField(formData: FormData): number {
	const value = formData.get('weeks');
	return typeof value === 'string' && value !== '' ? Number(value) : Number.NaN;
}

/**
 * The form „Frist für alte Daten“: after how many weeks without a member import the app shows
 * the notice. Weeks out of range keep their value and show the error at the field, in the
 * browser and after a refusal of the server.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.weeks The stored weeks.
 * @returns The section with the form.
 */
export function StaleWeeksForm({
	announce,
	weeks,
}: Readonly<{ announce: Announce; weeks: number }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitStaleImportWeeks);
	const headingId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const invalidMessage = t('contactSettings.staleWeeksInvalid', {
		max: MAX_STALE_IMPORT_WEEKS,
		min: MIN_STALE_IMPORT_WEEKS,
	});
	const [state, submitForm, isPending] = useActionState(
		async (_previous: WeeksState, formData: FormData): Promise<WeeksState> => {
			const result = await settle(save({ data: { weeks: weeksField(formData) } }));
			if (result === undefined) return null;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return null;
			}
			if (!result.ok) return { refused: true };
			// The notice about old member data follows the weeks.
			await router.invalidate();
			announce(t('contactSettings.staleWeeksSaved'), 'status');
			return null;
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	const validate = useCallback(
		(value: number) => (isValidStaleImportWeeks(value) ? null : invalidMessage),
		[invalidMessage],
	);
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> => (state === null ? {} : { weeks: invalidMessage }),
		[invalidMessage, state],
	);
	useEffect(() => {
		// A refused value gets the focus, so a screen reader reads it with its error.
		if (state !== null) inputRef.current?.focus();
	}, [state]);
	return (
		<section aria-labelledby={headingId} className="flex max-w-md flex-col gap-4">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('contactSettings.staleWeeksTitle')}
			</h2>
			<PostForm aria-labelledby={headingId} onSubmit={onSubmit} validationErrors={validationErrors}>
				<NumberField
					className="flex flex-col gap-1"
					// Out of range stays as typed and is shown as an error, never clamped silently.
					commitBehavior="validate"
					defaultValue={weeks}
					formatOptions={WEEK_FORMAT}
					isRequired
					maxValue={MAX_STALE_IMPORT_WEEKS}
					minValue={MIN_STALE_IMPORT_WEEKS}
					name="weeks"
					validate={validate}
				>
					<Label className="font-semibold">{t('contactSettings.staleWeeks')}</Label>
					{/* The button sits beside the input: the error appears on blur, below both, and so
					    never moves the button away from a pointer on its way to it. */}
					<div className="flex flex-wrap items-center gap-3">
						<Input className={`w-24 ${inputClass}`} ref={inputRef} />
						{/* The field's own button slots are for steppers; the submit button is none. */}
						<ButtonContext value={null}>
							<SubmitButton isPending={isPending}>{t('contactSettings.save')}</SubmitButton>
						</ButtonContext>
					</div>
					<Text className="text-sm text-gray-700" slot="description">
						{t('contactSettings.staleWeeksHelp')}
					</Text>
					<FieldError className="text-sm text-red-700" />
				</NumberField>
			</PostForm>
		</section>
	);
}
