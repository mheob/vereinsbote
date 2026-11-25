import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';
import type { FrameInfo } from '@/server/frame';

const linkClass =
	'font-semibold text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 aria-[current=page]:text-gray-900 aria-[current=page]:no-underline';

/** The start page is current only on itself, not below it. */
const ONLY_THIS_PAGE = { exact: true } as const;

/**
 * The link to the administration is never current: `/admin` leads on to the first admin page, and
 * the admin navigation marks the page the user is on, so only that one link says "current".
 */
const NEVER_CURRENT = { exact: true } as const;

/** The contact list is current whatever kind it shows. */
const ONLY_THIS_PATH = { exact: true, includeSearch: false } as const;

/**
 * The main navigation of a signed-in user: the start page, then each part the user may use. The
 * link of the current page is marked with `aria-current="page"` (TanStack Router sets it); the
 * start page and the contact list count only for themselves, whatever the kind of contact; the
 * link to the administration is never marked, the admin navigation marks the current admin page.
 *
 * @param props The props.
 * @param props.nav The links the user may follow (`loadFrameInfo`).
 * @returns The navigation.
 */
export function MainNav({ nav }: Readonly<{ nav: FrameInfo['nav'] }>): ReactNode {
	const t = useT();
	return (
		<nav aria-label={t('nav.label')}>
			<ul className="flex flex-wrap gap-x-6 gap-y-2">
				<li>
					<Link activeOptions={ONLY_THIS_PAGE} className={linkClass} to="/">
						{t('nav.home')}
					</Link>
				</li>
				{nav.contacts ? (
					<li>
						<Link activeOptions={ONLY_THIS_PATH} className={linkClass} to="/contacts">
							{t('nav.contacts')}
						</Link>
					</li>
				) : null}
				{nav.importMembers ? (
					<li>
						<Link className={linkClass} to="/contacts/import/members">
							{t('nav.importMembers')}
						</Link>
					</li>
				) : null}
				{nav.importPartners ? (
					<li>
						<Link className={linkClass} to="/contacts/import/partners">
							{t('nav.importPartners')}
						</Link>
					</li>
				) : null}
				{nav.templates ? (
					<li>
						<Link className={linkClass} to="/templates">
							{t('nav.templates')}
						</Link>
					</li>
				) : null}
				{nav.templates ? (
					<li>
						<Link className={linkClass} to="/images">
							{t('nav.images')}
						</Link>
					</li>
				) : null}
				{nav.admin ? (
					<li>
						<Link activeOptions={NEVER_CURRENT} className={linkClass} to="/admin">
							{t('nav.admin')}
						</Link>
					</li>
				) : null}
			</ul>
		</nav>
	);
}
