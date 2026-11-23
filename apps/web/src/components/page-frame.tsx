import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';

import { LanguageSwitcher } from './language-switcher';

/**
 * The frame of every page: skip link, header with the language switcher, and the main content.
 *
 * @param props The frame's props.
 * @param props.children The page.
 * @returns The frame.
 */
export function PageFrame({ children }: Readonly<{ children: ReactNode }>): ReactNode {
	const t = useT();
	return (
		<>
			<a
				className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-white focus:p-2"
				href="#main-content"
			>
				{t('a11y.skipLink')}
			</a>
			<header className="flex justify-end p-4">
				<LanguageSwitcher />
			</header>
			<main id="main-content">{children}</main>
		</>
	);
}
