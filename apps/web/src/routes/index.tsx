import { createFileRoute, Link, useLoaderData } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { linkClass } from '@/components/styles';
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
	const [{ requireRequestPrincipal }, { listAreas }, { getBrand }] = await Promise.all([
		import('@/platform/request-principal'),
		import('@/server/areas/areas'),
		import('@/server/brand/brand'),
	]);
	const { context, principal } = await requireRequestPrincipal();
	const areas = await listAreas(context.db, principal);
	// Admins are offered to set the brand up until it was saved once (design 7).
	const brand = principal.isAdmin ? await getBrand(context.db) : null;
	const brandSetup = brand !== null && !brand.configured;
	return {
		areas: areas.flatMap(({ id, level, name }) => (level === null ? [] : [{ id, level, name }])),
		brandSetup,
	};
});

export const Route = createFileRoute('/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function HomePage(): ReactNode {
		const t = useT();
		const { areas, brandSetup } = useLoaderData({ from: '/' });
		// Before the first member import the page says so, to readers of the members area and to
		// admins (design 11), with the link to the import for those who may import. The notice
		// comes with the page frame (`loadFrameInfo`).
		const notice = useLoaderData({ from: '__root__', select: (root) => root.frame?.notice });
		// Admins learn that login links and invitations do not go out yet (design 14).
		const noSystemSender = useLoaderData({
			from: '__root__',
			select: (root) => root.frame?.noSystemSender === true,
		});
		const systemSenderId = useId();
		return (
			<div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
				<h1 className="text-2xl font-bold">{t('home.title')}</h1>
				{noSystemSender ? (
					<section
						aria-labelledby={systemSenderId}
						className="flex flex-col gap-2 border-l-4 border-amber-600 bg-amber-50 px-4 py-3"
					>
						<p id={systemSenderId}>{t('home.noSystemSender')}</p>
						<Link className={`self-start ${linkClass}`} to="/admin/sending">
							{t('home.noSystemSenderLink')}
						</Link>
					</section>
				) : null}
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
				{brandSetup ? (
					<div className="flex flex-col gap-2">
						<p>{t('home.setupBrandText')}</p>
						<p>
							<Link className={linkClass} to="/admin/brand">
								{t('home.setupBrand')}
							</Link>
						</p>
					</div>
				) : null}
				{notice?.kind === 'firstImport' ? (
					<div className="flex flex-col gap-2">
						<p>{t('home.firstImport')}</p>
						{notice.canImport ? (
							<p>
								<Link className={linkClass} to="/contacts/import/members">
									{t('home.startFirstImport')}
								</Link>
							</p>
						) : null}
					</div>
				) : null}
			</div>
		);
	},
	head: (context) => pageHead(context, 'home.title'),
	loader: async () => loadHome(),
});
