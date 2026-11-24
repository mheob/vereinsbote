import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';

import { LanguageSwitcher } from './language-switcher';
import { SignOutButton } from './sign-out-button';

/**
 * The frame of every page: skip link, header with the language switcher and, for a signed-in
 * user, „Abmelden“, then the main content.
 *
 * @param props The frame's props.
 * @param props.children The page.
 * @param props.signedIn Whether the request has a valid session.
 * @returns The frame.
 */
export function PageFrame({
	children,
	signedIn,
}: Readonly<{ children: ReactNode; signedIn: boolean }>): ReactNode {
	const t = useT();
	return (
		<>
			<a
				className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-white focus:p-2"
				href="#main-content"
			>
				{t('a11y.skipLink')}
			</a>
			<header className="flex flex-wrap items-center justify-end gap-4 p-4">
				<LanguageSwitcher />
				{signedIn ? <SignOutButton /> : null}
			</header>
			<main id="main-content">{children}</main>
		</>
	);
}
