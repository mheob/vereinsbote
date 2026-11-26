import { createFileRoute, redirect, useSearch } from '@tanstack/react-router';
import { createServerFn, useServerFn } from '@tanstack/react-start';
import { useActionState, useId } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';
import { AFTER_SIGN_IN_PATH, LOGIN_PATH } from '@/paths';

/** Better Auth's tokens have 32 letters; anything far longer is no login link of this app. */
const MAX_TOKEN_LENGTH = 256;

/** The code the sign-in page gets for a link that is unknown, expired, used or of a disabled user. */
const INVALID_LINK_ERROR = 'INVALID_TOKEN';

const confirmRequest = z.object({ token: z.string().max(MAX_TOKEN_LENGTH) });

/**
 * Signs in with the token of a login link: only this POST uses it up, never opening the page, so
 * a mail scanner that opens the link leaves it valid. On success the session cookie goes on the
 * response and the start page loads in a new document (the frame of the page is resolved per
 * document, see the root route). A link that does not sign in leads back to the sign-in page with
 * its error. The token is never logged. Server modules are imported inside the handler, so they
 * stay out of the client bundle.
 */
const confirmLoginLink = createServerFn({ method: 'POST' })
	.validator(confirmRequest)
	.handler(async ({ data }): Promise<never> => {
		const [
			{ appendResponseHeader, getResponseHeaders },
			{ getAppContext },
			{ LoginLinkInvalidError, verifyLoginLink },
			{ forwardSetCookie },
		] = await Promise.all([
			import('@tanstack/react-start/server'),
			import('@/platform/context'),
			import('@/server/auth/auth'),
			import('@/server/auth/forward-cookies'),
		]);
		const { auth } = await getAppContext();
		let verified: { setCookie: string } | null = null;
		try {
			verified = await verifyLoginLink(auth, data.token);
		} catch (error) {
			if (!(error instanceof LoginLinkInvalidError)) throw error;
		}
		if (verified === null) {
			// oxlint-disable-next-line typescript/only-throw-error -- TanStack Start sends a thrown redirect to the client
			throw redirect({ search: { error: INVALID_LINK_ERROR }, to: LOGIN_PATH });
		}
		// Better Auth's TanStack plugin forwards the cookie too, but ignores failures; here a cookie
		// that does not reach the response fails the sign-in.
		forwardSetCookie(verified.setCookie, {
			append(cookies) {
				appendResponseHeader('set-cookie', [...cookies]);
			},
			current: () => getResponseHeaders().getSetCookie(),
		});
		// oxlint-disable-next-line typescript/only-throw-error -- TanStack Start sends a thrown redirect to the client
		throw redirect({ reloadDocument: true, to: AFTER_SIGN_IN_PATH });
	});

/** The failed attempts so far, so a repeated failure is announced again; 0 before the first. */
type ConfirmState = number;

export const Route = createFileRoute('/login_/confirm')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function ConfirmLoginPage(): ReactNode {
		const t = useT();
		const headingId = useId();
		const textId = useId();
		const { token } = useSearch({ from: '/login_/confirm' });
		const confirm = useServerFn(confirmLoginLink);
		const [failures, submitForm, isPending] = useActionState(
			async (previous: ConfirmState, formData: FormData): Promise<ConfirmState> => {
				const entered = formData.get('token');
				const result = await settle(
					confirm({ data: { token: typeof entered === 'string' ? entered : '' } }),
				);
				// Otherwise the server redirected: to the start page, or back to the sign-in page.
				return result === FAILED ? previous + 1 : previous;
			},
			0,
		);
		const onSubmit = useFormSubmit(submitForm);
		return (
			<div className="mx-auto flex max-w-md flex-col gap-6 p-6">
				<h1 className="text-2xl font-bold" id={headingId}>
					{t('auth.confirmTitle')}
				</h1>
				<p id={textId}>{t('auth.confirmText')}</p>
				<PostForm
					aria-describedby={textId}
					aria-labelledby={headingId}
					className="flex flex-col gap-4"
					onSubmit={onSubmit}
				>
					<input name="token" type="hidden" value={token ?? ''} />
					{failures === 0 ? null : (
						// A new element per attempt, so a repeated message is announced again.
						<p className="text-red-700" key={failures} role="alert">
							{t('auth.requestFailed')}
						</p>
					)}
					<SubmitButton isPending={isPending}>{t('auth.confirmSubmit')}</SubmitButton>
				</PostForm>
			</div>
		);
	},
	head: (context) => pageHead(context, 'auth.confirmTitle'),
	// A link mangled by a mail client still opens the page; its sign-in then fails as invalid.
	validateSearch: (search: Readonly<Record<string, unknown>>): { token?: string } =>
		typeof search.token === 'string' ? { token: search.token } : {},
});
