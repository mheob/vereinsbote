import { createFileRoute, Link, useLoaderData, useLocation } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { ConnectionsTable, SendersTable } from '@/components/admin/sending/sending-tables';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { clearHistoryNotice } from '@/components/contacts/history-notice';
import { linkClass } from '@/components/styles';
import { loadSendingOverview } from '@/functions/sending';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * The sending for admins: the connections to the mail providers with their state, the senders
 * with their connection and areas, and the links to create and change them. What a page just
 * created or deleted is announced here once, from the history state.
 */
export const Route = createFileRoute('/admin/sending/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function SendingPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/admin/sending/' });
		const notice = useLocation({ select: (location) => location.state.sendingNotice });
		const headingRef = useRef<HTMLHeadingElement>(null);
		const [announcement, announce] = useAnnouncer();
		useEffect(() => {
			if (notice === undefined) return;
			headingRef.current?.focus();
			announce(t(`sending.${notice.kind}`, { name: notice.name }), 'status');
			clearHistoryNotice(globalThis.history, 'sendingNotice');
		}, [announce, notice, t]);
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<div className="flex flex-col gap-8">
				<div className="flex max-w-3xl flex-col gap-2">
					<h1 className="text-2xl font-bold outline-none" ref={headingRef} tabIndex={-1}>
						{t('sending.title')}
					</h1>
					<p>{t('sending.intro')}</p>
					<Announcements announcement={announcement} />
				</div>
				<section className="flex flex-col gap-3">
					<h2 className="text-xl font-bold">{t('sending.connectionsHeading')}</h2>
					<ConnectionsTable connections={data.connections} />
					<Link className={`self-start ${linkClass}`} to="/admin/sending/connections/new">
						{t('sending.addConnection')}
					</Link>
				</section>
				<section className="flex flex-col gap-3">
					<h2 className="text-xl font-bold">{t('sending.sendersHeading')}</h2>
					{data.hasSystemSender ? null : <p>{t('sending.noSystemSender')}</p>}
					<SendersTable senders={data.senders} />
					{data.connections.length === 0 ? (
						<p>{t('sending.addSenderNeedsConnection')}</p>
					) : (
						<Link className={`self-start ${linkClass}`} to="/admin/sending/senders/new">
							{t('sending.addSender')}
						</Link>
					)}
				</section>
			</div>
		);
	},
	// A fresh overview on every visit.
	gcTime: 0,
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'sending.title'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context }) => (context.isAdmin ? loadSendingOverview() : null),
});
