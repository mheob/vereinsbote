import { createFileRoute, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { pageHead } from '@/i18n/page-title';

/**
 * The layout of the sending overview. Without a session the server functions of the pages send the
 * visitor to the sign-in page; they check the rights themselves, since they are reachable without
 * these pages.
 */
export const Route = createFileRoute('/sending')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function SendingLayout(): ReactNode {
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
				<Outlet />
			</div>
		);
	},
	// Each page names itself; this title is the fallback.
	head: (context) => pageHead(context, 'overview.title'),
});
