import { createFileRoute, Link, useLoaderData, useRouter } from '@tanstack/react-router';
import { startTransition, useCallback } from 'react';
import type { ReactNode } from 'react';

import { DeleteSendingDialog } from '@/components/admin/sending/delete-sending-dialog';
import { SelfTest } from '@/components/admin/sending/self-test-result';
import { SenderForm, SystemSenderControl } from '@/components/admin/sending/sender-form';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { linkClass } from '@/components/styles';
import { loadSenderPage } from '@/functions/sending';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * One sender for admins: its form, the system sender mark, the self test and „Löschen“. A sender
 * that does not exist is „not found“.
 */
export const Route = createFileRoute('/admin/sending/senders/$senderId')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function SenderPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const data = useLoaderData({ from: '/admin/sending/senders/$senderId' });
		const [announcement, announce] = useAnnouncer();
		const email = data?.sender?.email ?? '';
		const onDeleted = useCallback(() => {
			startTransition(async () => {
				await router.navigate({
					state: { sendingNotice: { kind: 'senderDeleted', name: email } },
					to: '/admin/sending',
				});
			});
		}, [email, router]);
		const onRefused = useCallback(() => {
			startTransition(async () => router.invalidate());
		}, [router]);
		// Without the admin role the layout shows "no access" instead of this page.
		const sender = data?.sender ?? null;
		if (data === null || sender === null) return null;
		return (
			<div className="flex flex-col gap-8">
				<Link className={`self-start ${linkClass}`} to="/admin/sending">
					{t('sending.back')}
				</Link>
				<div className="flex max-w-3xl flex-col gap-2">
					<h1 className="text-2xl font-bold">{sender.email}</h1>
					<Announcements announcement={announcement} />
				</div>
				<SenderForm announce={announce} key={sender.version} page={data} />
				<SystemSenderControl announce={announce} isSystem={sender.isSystem} senderId={sender.id} />
				<SelfTest
					announce={announce}
					defaultProbe={data.adminEmail}
					isGraph={sender.connectionKind === 'graph'}
					senderId={sender.id}
				/>
				<div>
					<DeleteSendingDialog
						announce={announce}
						id={sender.id}
						isDisabled={false}
						kind="sender"
						name={sender.email}
						onDeleted={onDeleted}
						onRefused={onRefused}
					/>
				</div>
			</div>
		);
	},
	// A fresh sender on every visit.
	gcTime: 0,
	// Without the admin role the page is "no access", and so is its title.
	head: (context: AdminTitleContext) => adminPageHead(context, 'sending.senderPageTitle'),
	// The admin layout has decided already; for anybody else there is nothing to load.
	loader: async ({ context, params }) =>
		context.isAdmin ? loadSenderPage({ data: { id: params.senderId } }) : null,
});
