import { createFileRoute, useLoaderData, useSearch } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { FieldError, Form, Input, Label, TextField } from 'react-aria-components';
import { z } from 'zod';

import { signInErrorMessage } from '@/components/sign-in-error';
import { inputClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { pageHead } from '@/i18n/page-title';
import type { MessageKey, MessageParams } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import { AFTER_SIGN_IN_PATH, LOGIN_PATH } from '@/paths';
import { normalizeEmail } from '@/server/auth/email';

const HTTP_TOO_MANY_REQUESTS = 429;

const socialSignInResponse = z.object({ url: z.url() });

/** The text of the status region, as key and params; null shows nothing. */
type StatusMessage = Readonly<{ key: MessageKey; params?: MessageParams }> | null;

const REQUEST_FAILED: StatusMessage = { key: 'auth.requestFailed' };

// Server modules are imported inside the handler, so they stay out of the client bundle.
const loadLoginOptions = createServerFn({ method: 'GET' }).handler(async () => {
	const { getAppContext } = await import('@/platform/context');
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
 * The message for a failed response: the rate limiter's 429 gets its own.
 *
 * @param response The response that is not ok.
 * @returns The message.
 */
function failureMessage(response: Response): StatusMessage {
	return response.status === HTTP_TOO_MANY_REQUESTS
		? { key: 'auth.tooManyRequests' }
		: REQUEST_FAILED;
}

/**
 * Requests a login link for the address in the form.
 *
 * @param formData The submitted e-mail form.
 * @returns The message for the status region.
 */
async function requestLink(formData: FormData): Promise<StatusMessage> {
	const entered = formData.get('email');
	const email = normalizeEmail(typeof entered === 'string' ? entered : '');
	try {
		// The link in the mail leads to the confirmation page (`/login/confirm`), whatever the body.
		const response = await postToAuth('/sign-in/magic-link', { email });
		return response.ok ? { key: 'auth.linkSent', params: { email } } : failureMessage(response);
	} catch {
		return REQUEST_FAILED;
	}
}

/**
 * Starts the Microsoft sign-in the way the Better Auth client does, then follows its redirect to
 * Microsoft.
 *
 * @returns No message on success (the page leaves), the failure message otherwise.
 */
async function startMicrosoftSignIn(): Promise<StatusMessage> {
	try {
		const response = await postToAuth('/sign-in/social', {
			callbackURL: AFTER_SIGN_IN_PATH,
			errorCallbackURL: LOGIN_PATH,
			provider: 'microsoft',
		});
		if (!response.ok) return failureMessage(response);
		const { url } = socialSignInResponse.parse(await response.json());
		globalThis.location.assign(url);
		return null;
	} catch {
		return REQUEST_FAILED;
	}
}

/**
 * The one action of both forms, so the status region has one message and the last action
 * replaces it. The Microsoft form says so in its hidden `intent` field.
 *
 * @param _previous The previous message (replaced).
 * @param formData The submitted form.
 * @returns The message for the status region.
 */
async function loginAction(_previous: StatusMessage, formData: FormData): Promise<StatusMessage> {
	return formData.get('intent') === 'microsoft' ? startMicrosoftSignIn() : requestLink(formData);
}

export const Route = createFileRoute('/login')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function LoginPage(): ReactNode {
		const t = useT();
		const { microsoft } = useLoaderData({ from: '/login' });
		const { error } = useSearch({ from: '/login' });
		const [message, submit] = useActionState(loginAction, null);

		return (
			<div className="mx-auto flex max-w-md flex-col gap-6 p-6">
				<h1 className="text-2xl font-bold">{t('auth.title')}</h1>
				{error === undefined ? null : (
					<p className="text-red-700" role="alert">
						{t(signInErrorMessage(error))}
					</p>
				)}
				<Form action={submit} className="flex flex-col gap-4">
					<TextField
						autoComplete="email"
						className="flex flex-col gap-1"
						isRequired
						name="email"
						type="email"
					>
						<Label className="font-semibold">{t('auth.emailLabel')}</Label>
						<Input className={inputClass} />
						<FieldError className="text-sm text-red-700" />
					</TextField>
					<SubmitButton>{t('auth.requestLink')}</SubmitButton>
				</Form>
				{microsoft ? (
					<Form action={submit}>
						<input name="intent" type="hidden" value="microsoft" />
						<SubmitButton>{t('auth.microsoft')}</SubmitButton>
					</Form>
				) : null}
				<output aria-live="polite">{message === null ? '' : t(message.key, message.params)}</output>
			</div>
		);
	},
	head: (context) => pageHead(context, 'auth.title'),
	loader: async () => loadLoginOptions(),
	validateSearch: z.object({ error: z.string().optional() }),
});
