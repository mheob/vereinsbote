import { createServerFn } from '@tanstack/react-start';
import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { Button, Form } from 'react-aria-components';
import { useFormStatus } from 'react-dom';
import { z } from 'zod';

import { LOCALE_COOKIE, SUPPORTED_LOCALES } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';
import { useLocale, useT } from '@/i18n/use-t';

import { changeLocale } from './change-locale';

/** One year. */
const LOCALE_COOKIE_MAX_AGE_SECONDS = 31_536_000;

const buttonClass =
	'rounded-md border border-gray-600 px-3 py-1 text-sm aria-[current=true]:bg-gray-900 aria-[current=true]:text-white data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-gray-100 data-pending:opacity-70 aria-[current=true]:data-hovered:bg-gray-800';

/**
 * Keeps the chosen language in the `locale` cookie and, for a signed-in user, in `user.locale`
 * (the language of the user's system mails). Server modules are imported inside the handler, so
 * they stay out of the client bundle.
 */
const saveLocale = createServerFn({ method: 'POST' })
	.validator(z.enum(SUPPORTED_LOCALES))
	.handler(async ({ data: locale }) => {
		const [{ getRequest, setCookie }, { getAppContext }, { getSessionUser }, { setUserLocale }] =
			await Promise.all([
				import('@tanstack/react-start/server'),
				import('@/platform/context'),
				import('@/server/auth/session'),
				import('@/server/users/repo'),
			]);
		const { auth, db, env } = await getAppContext();
		setCookie(LOCALE_COOKIE, locale, {
			maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
			path: '/',
			sameSite: 'lax',
			secure: env.appUrl.protocol === 'https:',
		});
		const user = await getSessionUser(auth, db, getRequest().headers);
		if (user !== null) await setUserLocale(db, user.id, locale);
	});

/**
 * Form action: saves the language of the pressed button, then reloads the page in it.
 *
 * @param failures How many saves have failed so far.
 * @param formData The submitted form with the pressed button's `locale`.
 * @returns The failures, one more when this save failed.
 */
async function chooseLocale(failures: number, formData: FormData): Promise<number> {
	const result = await changeLocale(formData, {
		reload() {
			globalThis.location.reload();
		},
		save: async (locale) => saveLocale({ data: locale }),
	});
	return result === 'failed' ? failures + 1 : failures;
}

function LocaleButton({
	locale,
	isCurrent,
}: Readonly<{ locale: Locale; isCurrent: boolean }>): ReactNode {
	const t = useT();
	const { pending } = useFormStatus();
	return (
		<Button
			aria-current={isCurrent ? 'true' : undefined}
			className={buttonClass}
			isPending={pending}
			lang={locale}
			name="locale"
			type="submit"
			value={locale}
		>
			{t(`language.${locale}`)}
		</Button>
	);
}

/**
 * Two buttons, „Deutsch“ and „English“, each named in its own language. The current one is
 * marked with `aria-current`. A failed save is announced next to them.
 *
 * @returns The language switcher.
 */
export function LanguageSwitcher(): ReactNode {
	const t = useT();
	const current = useLocale();
	const [failures, action] = useActionState(chooseLocale, 0);
	return (
		<Form action={action} className="flex flex-wrap items-center gap-2">
			<fieldset className="flex gap-2">
				<legend className="sr-only">{t('language.label')}</legend>
				{SUPPORTED_LOCALES.map((locale) => (
					<LocaleButton isCurrent={locale === current} key={locale} locale={locale} />
				))}
			</fieldset>
			{failures === 0 ? null : (
				// A new element per failure, so a repeated failure is announced again.
				<p className="text-sm text-red-700" key={failures} role="alert">
					{t('language.saveFailed')}
				</p>
			)}
		</Form>
	);
}
