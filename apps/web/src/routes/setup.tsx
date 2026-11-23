import { createFileRoute, Link, redirect, useLoaderData } from '@tanstack/react-router';
import { createServerFn, useServerFn } from '@tanstack/react-start';
import {
	startTransition,
	useActionState,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
} from 'react';
import type { ReactNode } from 'react';
import { FieldError, Form, Input, Label, TextField } from 'react-aria-components';
import type { FormProps } from 'react-aria-components';
import { z } from 'zod';

import { SubmitButton } from '@/components/submit-button';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import {
	MAX_EMAIL_LENGTH,
	MAX_NAME_LENGTH,
	MAX_TOKEN_LENGTH,
	invalidSetupFields,
	isValidAdminEmail,
	isValidAdminName,
} from '@/server/setup/form';
import type { SetupField } from '@/server/setup/form';

/** Where the first admin goes after the setup: the user management. */
const ADMIN_HOME_PATH = '/admin/users';

const inputClass =
	'rounded-md border border-gray-600 px-3 py-2 data-focused:outline-2 data-focused:outline-offset-2 data-focused:outline-blue-700 data-invalid:border-red-700';

/**
 * Why the server refused a submission: `fields` names the refused fields (a wrong token is one),
 * `done` shows the completed setup. A successful submission redirects instead.
 */
type SetupRefusal = Readonly<{
	failure: 'disabled' | 'done' | 'fields';
	fields: readonly SetupField[];
}>;

/**
 * The result of the last attempt, numbered so that a repeated failure is a new message; null
 * before the first. `failed` is any other error, with no detail from the server.
 */
type SetupState = Readonly<{
	attempt: number;
	failure: SetupRefusal['failure'] | 'failed';
	fields: readonly SetupField[];
}> | null;

/** The message at each refused field. */
const FIELD_MESSAGES: Readonly<Record<SetupField, MessageKey>> = {
	email: 'setup.emailInvalid',
	name: 'setup.nameInvalid',
	token: 'setup.tokenInvalid',
};

/**
 * The message above the button for a failure that belongs to no field.
 *
 * @param failure The reason of the last failed attempt, or null.
 * @returns The key of the message, or null for none.
 */
function formMessageKey(failure: NonNullable<SetupState>['failure'] | null): MessageKey | null {
	if (failure === 'disabled') return 'setup.disabled';
	// A generic message: the server tells nothing about unexpected failures.
	if (failure === 'failed') return 'auth.requestFailed';
	return null;
}

/** The transport shape; the rules of each field are checked by `invalidSetupFields`. */
const setupRequest = z.object({ email: z.string(), name: z.string(), token: z.string() });

// Server modules are imported inside the handlers, so they stay out of the client bundle.
// The form stays until the admin's first session exists, so a failed opening can be retried.
const loadSetupState = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ getAppContext }, { hasSetupSession }] = await Promise.all([
		import('@/platform/context'),
		import('@/server/setup/setup'),
	]);
	const { db } = await getAppContext();
	return { done: await hasSetupSession(db) };
});

/**
 * Completes the setup, signs the admin in and redirects to the user management. If the setup is
 * done but its session could not be opened, the same token and the admin's address open it now
 * (see `completeSetupAndSignIn`). A refusal comes back as its reason, never with a token.
 */
const submitSetup = createServerFn({ method: 'POST' })
	.validator(setupRequest)
	.handler(async ({ data }): Promise<SetupRefusal> => {
		const fields = invalidSetupFields(data);
		if (fields.length > 0) return { failure: 'fields', fields };
		const [
			{ appendResponseHeader, getRequest, getResponseHeaders },
			{ getAppContext },
			setup,
			{ createSessionFor },
			{ forwardSetCookie },
			{ getRequestLocale },
		] = await Promise.all([
			import('@tanstack/react-start/server'),
			import('@/platform/context'),
			import('@/server/setup/setup'),
			import('@/server/auth/auth'),
			import('@/server/auth/forward-cookies'),
			import('@/server/i18n/request-locale'),
		]);
		const { auth, db, env } = await getAppContext();
		try {
			await setup.completeSetupAndSignIn(
				db,
				{
					adminEmail: data.email,
					adminLocale: getRequestLocale(getRequest().headers),
					adminName: data.name,
					expectedToken: env.setupToken,
					token: data.token,
				},
				async (adminUserId) => {
					const { setCookie } = await createSessionFor(auth, adminUserId);
					// Better Auth's TanStack plugin forwards the cookie too, but ignores failures; here a
					// cookie that does not reach the response fails the opening, so it can be retried.
					forwardSetCookie(setCookie, {
						append(cookies) {
							appendResponseHeader('set-cookie', [...cookies]);
						},
						current: () => getResponseHeaders().getSetCookie(),
					});
				},
			);
		} catch (error) {
			if (error instanceof setup.SetupTokenInvalidError)
				return { failure: 'fields', fields: ['token'] };
			if (error instanceof setup.SetupDisabledError) return { failure: 'disabled', fields: [] };
			if (error instanceof setup.SetupAlreadyDoneError) return { failure: 'done', fields: [] };
			throw error;
		}
		// `href`: the user management is a route of a later step.
		// oxlint-disable-next-line typescript/only-throw-error -- TanStack Start sends a thrown redirect to the client
		throw redirect({ href: ADMIN_HOME_PATH });
	});

/**
 * Reads a text field of the submitted form.
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The value, or an empty string.
 */
function field(formData: FormData, name: SetupField): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

type SubmitSetup = (
	options: Readonly<{ data: z.input<typeof setupRequest> }>,
) => Promise<SetupRefusal | undefined>;

export const Route = createFileRoute('/setup')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function SetupPage(): ReactNode {
		const t = useT();
		const headingId = useId();
		const messageId = useId();
		const headingRef = useRef<HTMLHeadingElement>(null);
		const tokenRef = useRef<HTMLInputElement>(null);
		const nameRef = useRef<HTMLInputElement>(null);
		const emailRef = useRef<HTMLInputElement>(null);
		const { done } = useLoaderData({ from: '/setup' });
		// After following the redirect, `useServerFn` resolves without a result.
		const submit: SubmitSetup = useServerFn(submitSetup);
		const [state, submitForm, isPending] = useActionState(
			async (previous: SetupState, formData: FormData): Promise<SetupState> => {
				const attempt = (previous?.attempt ?? 0) + 1;
				try {
					const refusal = await submit({
						data: {
							email: field(formData, 'email'),
							name: field(formData, 'name'),
							token: field(formData, 'token'),
						},
					});
					return refusal === undefined ? null : { ...refusal, attempt };
				} catch {
					return { attempt, failure: 'failed', fields: [] };
				}
			},
			null,
		);
		// Submitted through `onSubmit`, not a form action: React resets a form after its action,
		// which would clear name and address after a wrong token.
		const onSubmit = useCallback<NonNullable<FormProps['onSubmit']>>(
			(event) => {
				event.preventDefault();
				const formData = new FormData(event.currentTarget);
				startTransition(() => {
					submitForm(formData);
				});
			},
			[submitForm],
		);
		// The browser checks the server's rules before sending; empty fields are left to `isRequired`.
		const validateName = useCallback(
			(value: string) => (value === '' || isValidAdminName(value) ? null : t('setup.nameInvalid')),
			[t],
		);
		const validateEmail = useCallback(
			(value: string) =>
				value === '' || isValidAdminEmail(value) ? null : t('setup.emailInvalid'),
			[t],
		);
		// A new object per attempt, so a refused field shows its error again after it was edited.
		const validationErrors = useMemo(
			(): Readonly<Record<string, string>> =>
				Object.fromEntries((state?.fields ?? []).map((name) => [name, t(FIELD_MESSAGES[name])])),
			[state, t],
		);
		const showDone = done || state?.failure === 'done';
		useEffect(() => {
			if (state === null) return;
			if (state.failure === 'done') {
				// The form is gone: focus moves to the top of the page, the status region says why.
				headingRef.current?.focus();
				return;
			}
			// Focus moves to the first refused field, so a screen reader reads it with its error.
			const [first] = state.fields;
			if (first !== undefined)
				({ email: emailRef, name: nameRef, token: tokenRef })[first].current?.focus();
		}, [state]);
		const messageKey = formMessageKey(state?.failure ?? null);

		return (
			<div className="mx-auto flex max-w-md flex-col gap-6 p-6">
				<h1 className="text-2xl font-bold" id={headingId} ref={headingRef} tabIndex={-1}>
					{t('setup.title')}
				</h1>
				{/* Always present, so switching to the completed setup is announced. */}
				<output aria-live="polite" className={showDone ? 'block' : 'sr-only'}>
					{showDone ? t('setup.done') : null}
				</output>
				{showDone ? (
					<Link
						className="self-start font-semibold text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
						to="/login"
					>
						{t('setup.toLogin')}
					</Link>
				) : (
					<Form
						aria-describedby={messageKey === null ? undefined : messageId}
						aria-labelledby={headingId}
						className="flex flex-col gap-4"
						onSubmit={onSubmit}
						validationErrors={validationErrors}
					>
						<TextField
							autoComplete="one-time-code"
							className="flex flex-col gap-1"
							isRequired
							maxLength={MAX_TOKEN_LENGTH}
							name="token"
							type="password"
						>
							<Label className="font-semibold">{t('setup.tokenLabel')}</Label>
							<Input
								autoCapitalize="off"
								className={inputClass}
								ref={tokenRef}
								spellCheck={false}
							/>
							<FieldError className="text-sm text-red-700" />
						</TextField>
						<TextField
							autoComplete="name"
							className="flex flex-col gap-1"
							isRequired
							maxLength={MAX_NAME_LENGTH}
							name="name"
							validate={validateName}
						>
							<Label className="font-semibold">{t('setup.nameLabel')}</Label>
							<Input className={inputClass} ref={nameRef} />
							<FieldError className="text-sm text-red-700" />
						</TextField>
						<TextField
							autoComplete="email"
							className="flex flex-col gap-1"
							isRequired
							maxLength={MAX_EMAIL_LENGTH}
							name="email"
							type="email"
							validate={validateEmail}
						>
							<Label className="font-semibold">{t('setup.emailLabel')}</Label>
							<Input className={inputClass} ref={emailRef} />
							<FieldError className="text-sm text-red-700" />
						</TextField>
						{messageKey === null ? null : (
							// A new element per attempt, so a repeated message is announced again.
							<p className="text-red-700" id={messageId} key={state?.attempt} role="alert">
								{t(messageKey)}
							</p>
						)}
						<SubmitButton isPending={isPending}>{t('setup.submit')}</SubmitButton>
					</Form>
				)}
			</div>
		);
	},
	loader: async () => loadSetupState(),
});
