/* oxlint-disable react/forbid-component-props -- React Aria components are styled through className */
import { createFileRoute, useLoaderData, useSearch } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { Button, FieldError, Form, Input, Label, TextField } from 'react-aria-components';
import { z } from 'zod';

import { t } from '../i18n/t';
import { normalizeEmail } from '../server/auth/email';

/** Where Better Auth sends the user after signing in, and back to after a failure. */
const AFTER_SIGN_IN_PATH = '/';
const LOGIN_PATH = '/login';

const buttonClass =
	'rounded-md bg-blue-700 px-4 py-2 font-semibold text-white data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-blue-800 data-pending:opacity-70';

const socialSignInResponse = z.object({ url: z.url() });

// Server modules are imported inside the handler, so they stay out of the client bundle.
const loadLoginOptions = createServerFn({ method: 'GET' }).handler(async () => {
	const { getAppContext } = await import('../platform/context');
	const { env } = await getAppContext();
	return { microsoft: env.microsoftLogin !== null };
});

/**
 * Posts JSON to a Better Auth endpoint. The page calls the HTTP endpoints, not server functions,
 * so Better Auth's rate limiter applies.
 *
 * @param path The endpoint path below `/api/auth`.
 * @param body The request body.
 * @returns The response.
 */
async function postToAuth(path: string, body: Readonly<Record<string, string>>): Promise<Response> {
	return fetch(`/api/auth${path}`, {
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	});
}

/**
 * Form action of the e-mail form: requests a login link.
 *
 * @param _previous The previous message (unused).
 * @param formData The submitted form.
 * @returns The message for the status region.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- FormData cannot be made readonly
async function requestLinkAction(_previous: string, formData: FormData): Promise<string> {
	const entered = formData.get('email');
	const email = normalizeEmail(typeof entered === 'string' ? entered : '');
	try {
		const response = await postToAuth('/sign-in/magic-link', {
			callbackURL: AFTER_SIGN_IN_PATH,
			email,
			errorCallbackURL: LOGIN_PATH,
		});
		return response.ok ? t('auth.linkSent', { email }) : t('auth.requestFailed');
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
		const response = await postToAuth('/sign-in/social', {
			callbackURL: AFTER_SIGN_IN_PATH,
			errorCallbackURL: LOGIN_PATH,
			provider: 'microsoft',
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
