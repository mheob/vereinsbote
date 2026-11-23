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

/** Where the first admin goes after the setup: the user management. */
const ADMIN_HOME_PATH = '/admin/users';
/** Limits that no real input reaches; they keep oversized requests away from the database. */
const MAX_TOKEN_LENGTH = 1024;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;

const inputClass =
	'rounded-md border border-gray-600 px-3 py-2 data-focused:outline-2 data-focused:outline-offset-2 data-focused:outline-blue-700 data-invalid:border-red-700';

/** Why the last attempt failed. `done` shows the completed setup instead of the form. */
type SetupFailure = 'disabled' | 'done' | 'failed' | 'tokenInvalid';

/** The result of the last attempt: a new object per failed attempt, null before the first. */
type SetupState = Readonly<{ failure: SetupFailure }> | null;

/**
 * The message above the button for a failure; a wrong token is shown at its field instead.
 *
 * @param failure The reason of the last failed attempt, or null.
 * @returns The key of the message, or null for none.
 */
function formMessageKey(failure: SetupFailure | null): MessageKey | null {
	if (failure === 'disabled') return 'setup.disabled';
	// A generic message: the server tells nothing about unexpected failures.
	if (failure === 'failed') return 'auth.requestFailed';
	return null;
}

const setupForm = z.object({
	email: z.string().trim().max(MAX_EMAIL_LENGTH).pipe(z.email()),
	name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
	token: z.string().min(1).max(MAX_TOKEN_LENGTH),
});

// Server modules are imported inside the handlers, so they stay out of the client bundle.
const loadSetupState = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ getAppContext }, { isSetupDone }] = await Promise.all([
		import('@/platform/context'),
		import('@/server/setup/setup'),
	]);
	const { db } = await getAppContext();
	return { done: await isSetupDone(db) };
});

/**
 * Completes the setup, signs the new admin in (the session cookie goes out with this response)
 * and redirects to the user management. A failure comes back as its reason, never with a token.
 */
const submitSetup = createServerFn({ method: 'POST' })
	.validator(setupForm)
	.handler(async ({ data }): Promise<Readonly<{ failure: SetupFailure }>> => {
		const [{ getRequest }, { getAppContext }, setup, { createSessionFor }, { getRequestLocale }] =
			await Promise.all([
				import('@tanstack/react-start/server'),
				import('@/platform/context'),
				import('@/server/setup/setup'),
				import('@/server/auth/auth'),
				import('@/server/i18n/request-locale'),
			]);
		const { auth, db, env } = await getAppContext();
		try {
			const { adminUserId } = await setup.completeSetup(db, {
				adminEmail: data.email,
				adminLocale: getRequestLocale(getRequest().headers),
				adminName: data.name,
				expectedToken: env.setupToken,
				token: data.token,
			});
			await createSessionFor(auth, adminUserId);
		} catch (error) {
			if (error instanceof setup.SetupTokenInvalidError) return { failure: 'tokenInvalid' };
			if (error instanceof setup.SetupDisabledError) return { failure: 'disabled' };
			if (error instanceof setup.SetupAlreadyDoneError) return { failure: 'done' };
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
function field(formData: FormData, name: string): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

type SubmitSetup = (
	options: Readonly<{ data: z.input<typeof setupForm> }>,
) => Promise<Readonly<{ failure: SetupFailure }> | undefined>;

export const Route = createFileRoute('/setup')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function SetupPage(): ReactNode {
		const t = useT();
		const headingId = useId();
		const messageId = useId();
		const tokenRef = useRef<HTMLInputElement>(null);
		const { done } = useLoaderData({ from: '/setup' });
		// After following the redirect, `useServerFn` resolves without a result.
		const submit: SubmitSetup = useServerFn(submitSetup);
		const [state, submitForm, isPending] = useActionState(
			async (_previous: SetupState, formData: FormData): Promise<SetupState> => {
				try {
					const result = await submit({
						data: {
							email: field(formData, 'email'),
							name: field(formData, 'name'),
							token: field(formData, 'token'),
						},
					});
					return result ?? null;
				} catch {
					return { failure: 'failed' };
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
		const failure = state?.failure ?? null;
		// A new object per attempt, so a wrong token shows again after the field was edited.
		const validationErrors = useMemo(
			(): Readonly<Record<string, string>> =>
				state?.failure === 'tokenInvalid' ? { token: t('setup.tokenInvalid') } : {},
			[state, t],
		);
		useEffect(() => {
			// Focus moves to the field, so a screen reader reads it together with its error.
			if (state?.failure === 'tokenInvalid') tokenRef.current?.focus();
		}, [state]);
		const messageKey = formMessageKey(failure);

		return (
			<div className="mx-auto flex max-w-md flex-col gap-6 p-6">
				<h1 className="text-2xl font-bold" id={headingId}>
					{t('setup.title')}
				</h1>
				{done || failure === 'done' ? (
					<>
						<p>{t('setup.done')}</p>
						<Link
							className="self-start font-semibold text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
							to="/login"
						>
							{t('setup.toLogin')}
						</Link>
					</>
				) : (
					<Form
						aria-describedby={messageKey === null ? undefined : messageId}
						aria-labelledby={headingId}
						className="flex flex-col gap-4"
						onSubmit={onSubmit}
						validationErrors={validationErrors}
					>
						<TextField autoComplete="off" className="flex flex-col gap-1" isRequired name="token">
							<Label className="font-semibold">{t('setup.tokenLabel')}</Label>
							<Input
								autoCapitalize="off"
								className={inputClass}
								ref={tokenRef}
								spellCheck={false}
							/>
							<FieldError className="text-sm text-red-700" />
						</TextField>
						<TextField autoComplete="name" className="flex flex-col gap-1" isRequired name="name">
							<Label className="font-semibold">{t('setup.nameLabel')}</Label>
							<Input className={inputClass} />
							<FieldError className="text-sm text-red-700" />
						</TextField>
						<TextField
							autoComplete="email"
							className="flex flex-col gap-1"
							isRequired
							name="email"
							type="email"
						>
							<Label className="font-semibold">{t('setup.emailLabel')}</Label>
							<Input className={inputClass} />
							<FieldError className="text-sm text-red-700" />
						</TextField>
						{messageKey === null ? null : (
							<p className="text-red-700" id={messageId} role="alert">
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
