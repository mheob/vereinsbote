import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';
import type { FrameInfo } from '@/server/frame';

import { StaleImportBanner } from './contacts/stale-import-banner';
import { LanguageSwitcher } from './language-switcher';
import { MainNav } from './main-nav';
import { SignOutButton } from './sign-out-button';

/**
 * The frame of every page: skip link, header with the main navigation of a signed-in user, the
 * language switcher and, for a signed-in user, the Sign out button, then the main content. When
 * the member data is old, the notice leads the main content, so the skip link reaches it too.
 *
 * @param props The frame's props.
 * @param props.children The page.
 * @param props.frame The navigation and the notice of a signed-in user, else null.
 * @param props.signedIn Whether the request has a valid session.
 * @returns The frame.
 */
export function PageFrame({
	children,
	frame,
	signedIn,
}: Readonly<{ children: ReactNode; frame: FrameInfo | null; signedIn: boolean }>): ReactNode {
	const t = useT();
	const notice = frame?.notice;
	return (
		<>
			<a
				className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-white focus:p-2"
				href="#main-content"
			>
				{t('a11y.skipLink')}
			</a>
			<header className="flex flex-wrap items-center gap-4 p-4">
				{frame === null ? null : <MainNav nav={frame.nav} />}
				<div className="ml-auto flex flex-wrap items-center gap-4">
					<LanguageSwitcher />
					{signedIn ? <SignOutButton /> : null}
				</div>
			</header>
			<main id="main-content">
				{notice?.kind === 'stale' ? <StaleImportBanner notice={notice} /> : null}
				{children}
			</main>
		</>
	);
}
