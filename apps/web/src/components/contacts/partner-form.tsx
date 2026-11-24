import { parseDate } from '@internationalized/date';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	DateField,
	DateInput,
	DateSegment,
	FieldError,
	I18nProvider,
	Input,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
	TextField,
} from 'react-aria-components';
import type { FormProps } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { ChevronIcon } from '@/components/icons';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import {
	inputClass,
	optionClass,
	popoverClass,
	secondaryButtonClass,
	selectButtonClass,
} from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { submitPartner } from '@/functions/contacts';
import type { MessageKey } from '@/i18n/translate';
import { useLocale, useT } from '@/i18n/use-t';
import { GENDERS } from '@/server/contacts/fields';
import { MAX_LENGTH } from '@/server/contacts/import/values';
import { invalidPartnerFields } from '@/server/contacts/partner-form';
import type { PartnerFieldErrors } from '@/server/contacts/partner-form';
import type { PartnerForm as PartnerFormData } from '@/server/contacts/partners';

import {
	customFieldName,
	firstInvalidField,
	partnerErrorMessages,
	partnerFieldOrder,
	readPartnerInput,
	withTag,
} from './partner-input';
import { TagField } from './tag-field';

/** The base text fields with their label and longest value, in form order. */
const TEXT_FIELDS = [
	{ label: 'import.field.customerNumber', maxLength: MAX_LENGTH.number, name: 'customerNumber' },
	{ label: 'import.field.organization', maxLength: MAX_LENGTH.name, name: 'organization' },
	{ label: 'import.field.firstName', maxLength: MAX_LENGTH.name, name: 'firstName' },
	{ label: 'import.field.lastName', maxLength: MAX_LENGTH.name, name: 'lastName' },
	{ label: 'import.field.email', maxLength: MAX_LENGTH.email, name: 'email' },
] as const satisfies readonly Readonly<{ label: MessageKey; maxLength: number; name: string }>[];

/** The longest value of the protected text fields of the address. */
const ADDRESS_MAX_LENGTH: Readonly<Record<'city' | 'postalCode' | 'street', number>> = {
	city: MAX_LENGTH.name,
	postalCode: MAX_LENGTH.postalCode,
	street: MAX_LENGTH.name,
};

const fieldClass = 'flex flex-col gap-1';
const errorClass = 'text-sm text-red-700';
const dateInputClass =
	'flex rounded-md border border-gray-600 px-3 py-2 data-focus-within:outline-2 data-focus-within:outline-offset-2 data-focus-within:outline-blue-700 data-invalid:border-red-700';
const segmentClass =
	'rounded-sm px-0.5 tabular-nums outline-none data-focused:bg-blue-700 data-focused:text-white data-placeholder:text-gray-700';

/** The address fields among the protected ones, in form order. */
const ADDRESS_FIELDS = ['street', 'postalCode', 'city'] as const;

/** What gets the focus in a field: a text input, the first segment of a date, the tag input. */
const FOCUSABLE = 'input:not([type="hidden"]):not([hidden]), [role="spinbutton"]';

type SubmitHandler = NonNullable<FormProps['onSubmit']>;

/** The refused fields of the last check, a new object per refusal; null before the first. */
type ShownErrors = Readonly<{ fields: PartnerFieldErrors }> | null;

/**
 * A date of the form, typed in segments; the form gets it as `YYYY-MM-DD`.
 *
 * @param props The props.
 * @param props.defaultValue The stored date as `YYYY-MM-DD`, or empty.
 * @param props.label The label.
 * @param props.name The name of the input.
 * @returns The field.
 */
function PartnerDateField({
	defaultValue,
	label,
	name,
}: Readonly<{ defaultValue: string; label: string; name: string }>): ReactNode {
	return (
		<DateField
			className={fieldClass}
			data-field={name}
			defaultValue={defaultValue === '' ? null : parseDate(defaultValue)}
			name={name}
		>
			<Label className="font-semibold">{label}</Label>
			<DateInput className={dateInputClass}>
				{(segment) => <DateSegment className={segmentClass} segment={segment} />}
			</DateInput>
			<FieldError className={errorClass} />
		</DateField>
	);
}

/**
 * A text field of the form.
 *
 * @param props The props.
 * @param props.defaultValue The stored value, or empty.
 * @param props.label The label.
 * @param props.maxLength The longest value.
 * @param props.name The name of the input.
 * @returns The field.
 */
function PartnerTextField({
	defaultValue,
	label,
	maxLength,
	name,
}: Readonly<{ defaultValue: string; label: string; maxLength: number; name: string }>): ReactNode {
	return (
		<TextField
			autoComplete="off"
			className={fieldClass}
			data-field={name}
			defaultValue={defaultValue}
			maxLength={maxLength}
			name={name}
		>
			<Label className="font-semibold">{label}</Label>
			<Input className={inputClass} />
			<FieldError className={errorClass} />
		</TextField>
	);
}

/**
 * The partner form, to add a partner or to edit one in place: customer number, organization,
 * names, address, gender, the protected and custom fields the user sees, and the tags. The
 * browser checks the server's rules before sending; a refused field shows its message at the
 * field and the first one gets the focus. A missing name shows once, at „Firma“.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.contactId The partner to edit, or null for a new one.
 * @param props.form The fields the user sees, the tag suggestions and the stored values.
 * @param props.labelledBy The id of the heading that names the form.
 * @param props.onCancel Ends editing without saving; a new partner has no „Abbrechen“.
 * @param props.onSaved Called with the partner's id once it is saved.
 * @returns The form.
 */
export function PartnerForm({
	announce,
	contactId,
	form,
	labelledBy,
	onCancel,
	onSaved,
}: Readonly<{
	announce: Announce;
	contactId: string | null;
	form: PartnerFormData;
	labelledBy: string;
	onCancel?: () => void;
	onSaved: (contactId: string) => Promise<void>;
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const save = useServerFn(submitPartner);
	const formRef = useRef<HTMLFormElement>(null);
	const [tags, setTags] = useState<readonly string[]>(form.values?.tags ?? []);
	const [tagInput, setTagInput] = useState('');
	const [errors, setErrors] = useState<ShownErrors>(null);
	const [isPending, startPending] = useTransition();
	const values = form.values;
	const order = useMemo(() => partnerFieldOrder(form), [form]);
	const messages = useMemo(
		() => Object.entries(partnerErrorMessages(errors?.fields ?? {})),
		[errors],
	);
	// A new object per refusal, so a refused field shows its error again after it was edited.
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> =>
			Object.fromEntries(messages.map(([name, key]) => [name, t(key)])),
		[messages, t],
	);
	useEffect(() => {
		// The first refused field gets the focus, so a screen reader reads it with its message.
		if (errors === null) return;
		const first = firstInvalidField(errors.fields, order);
		if (first === null) return;
		const field = formRef.current?.querySelector(`[data-field="${CSS.escape(first)}"]`);
		field?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
	}, [errors, order]);
	const onSubmit = useCallback<SubmitHandler>(
		(event) => {
			event.preventDefault();
			// Enter in a field submits as well; one save at a time.
			if (isPending) return;
			// A tag typed but not yet added is saved as well.
			const allTags = tagInput.trim() === '' ? tags : withTag(tags, tagInput, form.tagSuggestions);
			setTags(allTags);
			setTagInput('');
			const input = readPartnerInput(new FormData(event.currentTarget), form, allTags);
			const refused = invalidPartnerFields(input, form.customFields);
			if (Object.keys(refused).length > 0) {
				setErrors({ fields: refused });
				return;
			}
			// Copies: the request takes plain arrays and records.
			const data = { ...input, custom: { ...input.custom }, tags: [...input.tags] };
			startPending(async () => {
				const result = await settle(
					save({ data: contactId === null ? data : { ...data, contactId } }),
				);
				if (result === undefined) return;
				if (result === FAILED) announce(t('auth.requestFailed'), 'alert');
				else if (result.ok) await onSaved(result.contactId);
				else if ('fields' in result) setErrors({ fields: result.fields });
				else announce(t('contact.gone'), 'alert');
			});
		},
		[announce, contactId, form, isPending, onSaved, save, t, tagInput, tags],
	);
	return (
		// Dates and React Aria's own texts follow the page's language, in the server render as well.
		<I18nProvider locale={locale === 'de' ? 'de-DE' : 'en-US'}>
			<PostForm
				aria-labelledby={labelledBy}
				className="flex max-w-3xl flex-col gap-6"
				onSubmit={onSubmit}
				ref={formRef}
				// The form checks itself on submit; a field's message stays until the next check.
				validationBehavior="aria"
				validationErrors={validationErrors}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					{TEXT_FIELDS.map((field) => (
						<PartnerTextField
							defaultValue={values?.[field.name] ?? ''}
							key={field.name}
							label={t(field.label)}
							maxLength={field.maxLength}
							name={field.name}
						/>
					))}
					<Select
						className={fieldClass}
						defaultValue={values?.gender ?? 'unspecified'}
						name="gender"
					>
						<Label className="font-semibold">{t('import.field.gender')}</Label>
						<Button className={selectButtonClass}>
							<SelectValue />
							<ChevronIcon />
						</Button>
						<Popover className={popoverClass}>
							<ListBox className="outline-none">
								{GENDERS.map((gender) => (
									<ListBoxItem className={optionClass} id={gender} key={gender}>
										{t(`import.gender.${gender}`)}
									</ListBoxItem>
								))}
							</ListBox>
						</Popover>
					</Select>
					{form.protectedFields.includes('birthDate') ? (
						<PartnerDateField
							defaultValue={values?.birthDate ?? ''}
							label={t('import.field.birthDate')}
							name="birthDate"
						/>
					) : null}
					{ADDRESS_FIELDS.filter((field) => form.protectedFields.includes(field)).map((field) => (
						<PartnerTextField
							defaultValue={values?.[field] ?? ''}
							key={field}
							label={t(`import.field.${field}`)}
							maxLength={ADDRESS_MAX_LENGTH[field]}
							name={field}
						/>
					))}
					{form.customFields.map((field) =>
						field.type === 'date' ? (
							<PartnerDateField
								defaultValue={values?.custom?.[field.id] ?? ''}
								key={field.id}
								label={field.name}
								name={customFieldName(field.id)}
							/>
						) : (
							<PartnerTextField
								defaultValue={values?.custom?.[field.id] ?? ''}
								key={field.id}
								label={field.name}
								maxLength={MAX_LENGTH.customText}
								name={customFieldName(field.id)}
							/>
						),
					)}
				</div>
				<TagField
					announce={announce}
					errorMessage={validationErrors.tags}
					input={tagInput}
					onChange={setTags}
					onInputChange={setTagInput}
					suggestions={form.tagSuggestions}
					tags={tags}
				/>
				<div className="flex flex-wrap gap-3">
					<SubmitButton isPending={isPending}>{t('partner.save')}</SubmitButton>
					{onCancel === undefined ? null : (
						<Button className={secondaryButtonClass} onPress={onCancel}>
							{t('partner.cancel')}
						</Button>
					)}
				</div>
			</PostForm>
		</I18nProvider>
	);
}
