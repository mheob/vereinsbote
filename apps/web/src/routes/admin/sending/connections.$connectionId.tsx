import { createFileRoute, Link, useLoaderData, useRouter } from '@tanstack/react-router';
import { startTransition, useCallback, useId } from 'react';
import type { ReactNode } from 'react';

import { ConnectionForm } from '@/components/admin/sending/connection-form';
import { DeleteSendingDialog } from '@/components/admin/sending/delete-sending-dialog';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import { loadConnectionPage } from '@/functions/sending';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * One connection for admins: its form (secrets are empty fields that keep the stored value) and
 * „Löschen“, which a connection with senders does not allow. A connection that does not exist
 * is „not found“.
 */
export const Route = createFileRoute('/admin/sending/connections/$connectionId')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function ConnectionPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const data = useLoaderData({ from: '/admin/sending/connections/$connectionId' });
		const [announcement, announce] = useAnnouncer();
		const usageId = useId();
		const name = data?.connection.name ?? '';
		const onDeleted = useCallback(() => {
			startTransition(async () => {
				await router.navigate({
					state: { sendingNotice: { kind: 'connectionDeleted', name } },
					to: '/admin/sending',
				});
			});
		}, [name, router]);
		const onRefused = useCallback(() => {
			startTransition(async () => router.invalidate());
		}, [router]);
		// Without the admin role the layout shows "no access" instead of this page.
		if (data === null) return null;
		const { connection } = data;
		return (
			<div className="flex flex-col gap-6">
				<Link className={`self-start ${linkClass}`} to="/admin/sending">
					{t('sending.back')}
				</Link>
				<div className="flex max-w-3xl flex-col gap-2">
					<h1 className="text-2xl font-bold">{connection.name}</h1>
					<Announcements announcement={announcement} />
				</div>
				<ConnectionForm announce={announce} connection={connection} />
				<div className="flex max-w-xl flex-col gap-2">
					{connection.senders > 0 ? (
						<p id={usageId}>{t('sending.connectionInUseNote', { count: connection.senders })}</p>
					) : null}
					<div>
						<DeleteSendingDialog
							announce={announce}
							describedBy={connection.senders > 0 ? usageId : undefined}
							id={connection.id}
							isDisabled={connection.senders > 0}
							kind="connection"
							name={connection.name}
							onDeleted={onDeleted}
							onRefused={onRefused}
						/>
					</div>
				</div>
			</div>
		);
	},
	// A fresh connection on every visit.
	gcTime: 0,
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'sending.connectionPageTitle'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context, params }) =>
		context.isAdmin ? loadConnectionPage({ data: { id: params.connectionId } }) : null,
});
