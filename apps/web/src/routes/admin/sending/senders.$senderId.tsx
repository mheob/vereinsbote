import {
	createFileRoute,
	Link,
	useLoaderData,
	useLocation,
	useRouter,
} from '@tanstack/react-router';
import { startTransition, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { DeleteSendingDialog } from '@/components/admin/sending/delete-sending-dialog';
import { SelfTest } from '@/components/admin/sending/self-test-result';
import { SenderForm } from '@/components/admin/sending/sender-form';
import { SystemSenderControl } from '@/components/admin/sending/system-sender-control';
import { Announcements, useAnnouncer } from '@/components/announcements';
import { clearHistoryNotice } from '@/components/contacts/history-notice';
import { linkClass } from '@/components/styles';
import { loadSenderPage } from '@/functions/sending';
import { adminPageHead } from '@/i18n/page-title';
import type { AdminTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';
import type { SelfTestResult } from '@/server/sending/open-transport';

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
		const notice = useLocation({ select: (location) => location.state.sendingNotice });
		const stateTest = useLocation({ select: (location) => location.state.sendingSelfTest });
		// The self test a save ran (a new sender's, or a changed address or connection), then reruns.
		const [result, setResult] = useState<SelfTestResult | null>(stateTest ?? null);
		useEffect(() => {
			if (notice?.kind === 'senderCreated') {
				announce(t('sending.senderCreated', { name: notice.name }), 'status');
				clearHistoryNotice(globalThis.history, 'sendingNotice');
			}
			clearHistoryNotice(globalThis.history, 'sendingSelfTest');
		}, [announce, notice, t]);
		const wasSystem = data?.sender?.isSystem === true;
		const onDeleted = useCallback(() => {
			startTransition(async () => {
				await router.navigate({
					state: { sendingNotice: { kind: 'senderDeleted', name: email } },
					to: '/admin/sending',
				});
				// The page frame tells admins when no system sender is left (`loadFrameInfo`).
				if (wasSystem) await router.invalidate();
			});
		}, [email, router, wasSystem]);
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
				<SenderForm announce={announce} key={sender.version} onSelfTest={setResult} page={data} />
				<SystemSenderControl announce={announce} isSystem={sender.isSystem} senderId={sender.id} />
				<SelfTest
					announce={announce}
					defaultProbe={data.adminEmail}
					isGraph={sender.connectionKind === 'graph'}
					onResult={setResult}
					result={result}
					senderId={sender.id}
				/>
				<div>
					<DeleteSendingDialog
						announce={announce}
						id={sender.id}
						isDisabled={false}
						isSystem={sender.isSystem}
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
