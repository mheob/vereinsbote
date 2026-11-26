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
 * The number of bounce marks at „Versand“: a badge for the eye, the number with its noun for
 * screen readers, so the link reads „Versand 3 Rückläufer“. Nothing without marks.
 *
 * @param props The props.
 * @param props.count The number of marks the user sees.
 * @returns The badge, or nothing.
 */
function BounceBadge({ count }: Readonly<{ count: number }>): ReactNode {
	const t = useT();
	if (count === 0) return null;
	return (
		<>
			{' '}
			<span
				aria-hidden="true"
				className="ml-1 inline-block rounded-full bg-red-700 px-2 text-sm text-white no-underline"
			>
				{count}
			</span>
			<span className="sr-only">
				{count === 1 ? t('nav.bouncesOne') : t('nav.bounces', { count })}
			</span>
		</>
	);
}

/**
 * The main navigation of a signed-in user: the start page, then each part the user may use; the
 * sending overview shows the number of bounce marks the user sees. The link of the current page is
 * marked with `aria-current="page"` (TanStack Router sets it); the start page and the contact list
 * count only for themselves, whatever the kind of contact; the link to the administration is never
 * marked, the admin navigation marks the current admin page.
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
				{nav.occasions ? (
					<li>
						<Link className={linkClass} to="/occasions">
							{t('nav.occasions')}
						</Link>
					</li>
				) : null}
				{nav.sending ? (
					<li>
						<Link className={linkClass} to="/sending">
							{t('nav.sending')}
							<BounceBadge count={nav.bounces} />
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
