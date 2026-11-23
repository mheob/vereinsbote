/* oxlint-disable react/forbid-component-props -- React Aria components are styled through className */
import { createFileRoute, useLoaderData, useSearch } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { Button, FieldError, Form, Input, Label, TextField } from 'react-aria-components';
import { z } from 'zod';

import { t } from '../i18n/t';

/** Where Better Auth sends the user after signing in, and back to after a failure. */
const AFTER_SIGN_IN_PATH = '/';
const LOGIN_PATH = '/login';

const buttonClass =
	'rounded-md bg-blue-700 px-4 py-2 font-semibold text-white data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-blue-800 data-pending:opacity-70';

const emailInput = z.string().trim().pipe(z.email());
const requestLinkInput = z.object({ email: emailInput });
const socialSignInResponse = z.object({ url: z.url() });

// Server modules are imported inside the handlers, so they stay out of the client bundle.
const loadLoginOptions = createServerFn({ method: 'GET' }).handler(async () => {
	const { getAppContext } = await import('../platform/context');
	const { env } = await getAppContext();
	return { microsoft: env.microsoftLogin !== null };
});

const requestLink = createServerFn({ method: 'POST' })
	.validator(requestLinkInput)
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the handler context is TanStack Start's
	.handler(async ({ data }) => {
		const [{ getAppContext }, { requestLoginLink }, { normalizeEmail }] = await Promise.all([
			import('../platform/context'),
			import('../server/auth/auth'),
			import('../server/auth/email'),
		]);
		const { auth } = await getAppContext();
		await requestLoginLink(auth, data.email);
		return { email: normalizeEmail(data.email) };
	});

/**
 * Form action of the e-mail form: requests a login link.
 *
 * @param _previous The previous message (unused).
 * @param formData The submitted form.
 * @returns The message for the status region.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- FormData cannot be made readonly
async function requestLinkAction(_previous: string, formData: FormData): Promise<string> {
	const email = formData.get('email');
	try {
		const sent = await requestLink({ data: { email: typeof email === 'string' ? email : '' } });
		return t('auth.linkSent', { email: sent.email });
	} catch {
		return t('auth.requestFailed');
	}
}

/**
 * Form action of the Microsoft button: starts the sign-in the way the Better Auth client does,
 * then follows its redirect to Microsoft.
 *
 * @returns An empty message on success, the failure message otherwise.
 */
async function microsoftAction(): Promise<string> {
	try {
		const response = await fetch('/api/auth/sign-in/social', {
			body: JSON.stringify({
				callbackURL: AFTER_SIGN_IN_PATH,
				errorCallbackURL: LOGIN_PATH,
				provider: 'microsoft',
			}),
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		});
		if (!response.ok) return t('auth.requestFailed');
		const { url } = socialSignInResponse.parse(await response.json());
		globalThis.location.assign(url);
		return '';
	} catch {
		return t('auth.requestFailed');
	}
}

export const Route = createFileRoute('/login')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function LoginPage(): ReactNode {
		const { microsoft } = useLoaderData({ from: '/login' });
		const { error } = useSearch({ from: '/login' });
		const [linkMessage, submitEmail, isRequesting] = useActionState(requestLinkAction, '');
		const [microsoftMessage, submitMicrosoft, isRedirecting] = useActionState(microsoftAction, '');

		return (
			<div className="mx-auto flex max-w-md flex-col gap-6 p-6">
				<h1 className="text-2xl font-bold">{t('auth.title')}</h1>
				{error === undefined ? null : (
					<p className="text-red-700" role="alert">
						{t('auth.signInFailed')}
					</p>
				)}
				<Form action={submitEmail} className="flex flex-col gap-4">
					<TextField
						autoComplete="email"
						className="flex flex-col gap-1"
						isRequired
						name="email"
						type="email"
					>
						<Label className="font-semibold">{t('auth.emailLabel')}</Label>
						<Input className="rounded-md border border-gray-600 px-3 py-2 data-focused:outline-2 data-focused:outline-offset-2 data-focused:outline-blue-700" />
						<FieldError className="text-sm text-red-700" />
					</TextField>
					<Button className={buttonClass} isPending={isRequesting} type="submit">
						{t('auth.requestLink')}
					</Button>
				</Form>
				{microsoft ? (
					<Form action={submitMicrosoft}>
						<Button className={buttonClass} isPending={isRedirecting} type="submit">
							{t('auth.microsoft')}
						</Button>
					</Form>
				) : null}
				<output aria-live="polite">
					{microsoftMessage === '' ? linkMessage : microsoftMessage}
				</output>
			</div>
		);
	},
	loader: async () => loadLoginOptions(),
	validateSearch: z.object({ error: z.string().optional() }),
});
