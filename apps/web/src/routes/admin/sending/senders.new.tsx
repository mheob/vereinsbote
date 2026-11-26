import { createFileRoute, Link, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { SenderForm } from '@/components/admin/sending/sender-form';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import { loadSenderPage } from '@/functions/sending';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * A new sender is tested and shown on its own page, which it navigates to.
 *
 * @returns Nothing.
 */
function ignoreSelfTest(): void {
	// nothing to do here
}

/** „Absender anlegen“ for admins: address, connection, limits and released areas. */
export const Route = createFileRoute('/admin/sending/senders/new')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function NewSenderPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/admin/sending/senders/new' });
		const [announcement, announce] = useAnnouncer();
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<div className="flex flex-col gap-6">
				<Link className={`self-start ${linkClass}`} to="/admin/sending">
					{t('sending.back')}
				</Link>
				<div className="flex max-w-3xl flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('sending.senderNewTitle')}</h1>
					<Announcements announcement={announcement} />
				</div>
				{data.connections.length === 0 ? (
					<p>{t('sending.addSenderNeedsConnection')}</p>
				) : (
					<SenderForm announce={announce} onSelfTest={ignoreSelfTest} page={data} />
				)}
			</div>
		);
	},
	// A fresh form on every visit.
	gcTime: 0,
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'sending.senderNewTitle'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context }) => (context.isAdmin ? loadSenderPage({ data: { id: null } }) : null),
});
