import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useActionState, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	CheckboxButton,
	CheckboxField,
	FieldError,
	Form,
	Input,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
	TextField,
} from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { CheckIcon, ChevronIcon } from '@/components/icons';
import {
	checkboxBoxClass,
	checkboxClass,
	inputClass,
	optionClass,
	popoverClass,
	selectButtonClass,
} from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { submitInvite } from '@/functions/users';
import type { InviteFieldError, InviteFieldErrors } from '@/functions/users';
import { isLocale, SUPPORTED_LOCALES } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import {
	MAX_EMAIL_LENGTH,
	MAX_NAME_LENGTH,
	isValidUserEmail,
	isValidUserName,
} from '@/server/users/form';
import type { InviteField } from '@/server/users/form';

/** The fields of the invitation form, in form order. */
const INVITE_FIELDS: readonly InviteField[] = ['name', 'email'];

/** The fields of the last refused invitation; null before the first and after a success. */
type InviteState = Readonly<{ fields: InviteFieldErrors }> | null;

/**
 * The message at a refused invitation field.
 *
 * @param field The field.
 * @param error Why it was refused.
 * @returns The key of the message.
 */
function fieldMessage(field: InviteField, error: InviteFieldError): MessageKey {
	if (field === 'name') return 'users.nameInvalid';
	return error === 'taken' ? 'users.emailTaken' : 'users.emailInvalid';
}

/**
 * Reads a text field of the submitted form.
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The value, or an empty string.
 */
function textField(formData: FormData, name: InviteField): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

/**
 * The invitation form: name, address, admin role and the language of the invitation. Refused
 * fields show their message at the field and get the focus; after a success the form is empty
 * again and the table shows the new user.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.inviteLocale The language the form proposes: the inviting admin's.
 * @returns The form.
 */
export function InviteForm({
	announce,
	inviteLocale,
}: Readonly<{ announce: Announce; inviteLocale: Locale }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const invite = useServerFn(submitInvite);
	const headingId = useId();
	const formRef = useRef<HTMLFormElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const emailRef = useRef<HTMLInputElement>(null);
	const [state, submitForm, isPending] = useActionState(
		async (_previous: InviteState, formData: FormData): Promise<InviteState> => {
			const name = textField(formData, 'name');
			const locale = formData.get('locale');
			try {
				const result = await invite({
					data: {
						email: textField(formData, 'email'),
						isAdmin: formData.has('isAdmin'),
						locale: isLocale(locale) ? locale : inviteLocale,
						name,
					},
				});
				if (!result.ok) return { fields: result.fields };
				formRef.current?.reset();
				await router.invalidate();
				const message = result.mailSent ? 'users.invited' : 'users.invitedWithoutMail';
				announce(t(message, { name: name.trim() }), result.mailSent ? 'status' : 'alert');
			} catch {
				announce(t('auth.requestFailed'), 'alert');
			}
			return null;
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	// The browser checks the server's rules before sending; empty fields are left to `isRequired`.
	const validateName = useCallback(
		(value: string) => (value === '' || isValidUserName(value) ? null : t('users.nameInvalid')),
		[t],
	);
	const validateEmail = useCallback(
		(value: string) => (value === '' || isValidUserEmail(value) ? null : t('users.emailInvalid')),
		[t],
	);
	// A new object per refusal, so a refused field shows its error again after it was edited.
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> =>
			Object.fromEntries(
				INVITE_FIELDS.flatMap((field) => {
					const error = state?.fields[field];
					return error === undefined ? [] : [[field, t(fieldMessage(field, error))]];
				}),
			),
		[state, t],
	);
	useEffect(() => {
		// Focus moves to the first refused field, so a screen reader reads it with its error.
		const first = INVITE_FIELDS.find((field) => state?.fields[field] !== undefined);
		if (first !== undefined) ({ email: emailRef, name: nameRef })[first].current?.focus();
	}, [state]);

	return (
		<section aria-labelledby={headingId} className="flex max-w-md flex-col gap-4">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('users.inviteTitle')}
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
					maxLength={MAX_NAME_LENGTH}
					name="name"
					validate={validateName}
				>
					<Label className="font-semibold">{t('users.nameLabel')}</Label>
					<Input className={inputClass} ref={nameRef} />
					<FieldError className="text-sm text-red-700" />
				</TextField>
				<TextField
					autoComplete="off"
					className="flex flex-col gap-1"
					isRequired
					maxLength={MAX_EMAIL_LENGTH}
					name="email"
					type="email"
					validate={validateEmail}
				>
					<Label className="font-semibold">{t('users.emailLabel')}</Label>
					<Input className={inputClass} ref={emailRef} />
					<FieldError className="text-sm text-red-700" />
				</TextField>
				<CheckboxField name="isAdmin">
					<CheckboxButton className={checkboxClass}>
						{({ isSelected }) => (
							<>
								<span className={checkboxBoxClass}>{isSelected ? <CheckIcon /> : null}</span>
								{t('users.inviteAdmin')}
							</>
						)}
					</CheckboxButton>
				</CheckboxField>
				<Select className="flex flex-col gap-1" defaultValue={inviteLocale} name="locale">
					<Label className="font-semibold">{t('users.inviteLocale')}</Label>
					<Button className={selectButtonClass}>
						<SelectValue />
						<ChevronIcon />
					</Button>
					<Popover className={popoverClass}>
						<ListBox className="outline-none">
							{SUPPORTED_LOCALES.map((locale) => (
								<ListBoxItem
									className={optionClass}
									id={locale}
									key={locale}
									textValue={t(`language.${locale}`)}
								>
									{/* Each language is named in its own language. */}
									<span lang={locale}>{t(`language.${locale}`)}</span>
								</ListBoxItem>
							))}
						</ListBox>
					</Popover>
				</Select>
				<SubmitButton isPending={isPending}>{t('users.inviteSubmit')}</SubmitButton>
			</Form>
		</section>
	);
}
