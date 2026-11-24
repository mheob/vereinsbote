import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';

const linkClass =
	'font-semibold text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 aria-[current=page]:text-gray-900 aria-[current=page]:no-underline';

/**
 * The links between the admin pages. The link of the current page is marked with
 * `aria-current="page"` (TanStack Router sets it).
 *
 * @returns The navigation.
 */
export function AdminNav(): ReactNode {
	const t = useT();
	return (
		<nav aria-label={t('admin.navLabel')}>
			<ul className="flex gap-6">
				<li>
					<Link className={linkClass} to="/admin/users">
						{t('admin.navUsers')}
					</Link>
				</li>
				<li>
					<Link className={linkClass} to="/admin/areas">
						{t('admin.navAreas')}
					</Link>
				</li>
				<li>
					<Link className={linkClass} to="/admin/contact-settings">
						{t('admin.navContactSettings')}
					</Link>
				</li>
			</ul>
		</nav>
	);
}
