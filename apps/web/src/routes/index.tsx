import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';

import { AdminNav } from '@/components/admin-nav';
import { LEVEL_MESSAGES } from '@/i18n/levels';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * The areas the signed-in user has a level in, by name; without a session the visitor goes to
 * the sign-in page. Admins see every area in `listAreas`, but the role gives no access, so only
 * areas with a level are theirs. Server modules are imported inside the handler, so they stay out
 * of the client bundle.
 */
const loadHome = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ requireRequestPrincipal }, { listAreas }] = await Promise.all([
		import('@/platform/request-principal'),
		import('@/server/areas/areas'),
	]);
	const { context, principal } = await requireRequestPrincipal();
	const areas = await listAreas(context.db, principal);
	return {
		areas: areas.flatMap(({ id, level, name }) => (level === null ? [] : [{ id, level, name }])),
		isAdmin: principal.isAdmin,
	};
});

export const Route = createFileRoute('/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function HomePage(): ReactNode {
		const t = useT();
		const { areas, isAdmin } = useLoaderData({ from: '/' });
		return (
			<div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
				{isAdmin ? <AdminNav /> : null}
				<h1 className="text-2xl font-bold">{t('home.title')}</h1>
				{areas.length === 0 ? (
					<p>{t('home.noAreas')}</p>
				) : (
					<ul className="flex list-disc flex-col gap-1 pl-6">
						{areas.map(({ id, level, name }) => (
							<li key={id}>
								{t('home.areaLevel', { area: name, level: t(LEVEL_MESSAGES[level]) })}
							</li>
						))}
					</ul>
				)}
			</div>
		);
	},
	head: (context) => pageHead(context, 'home.title'),
	loader: async () => loadHome(),
});
