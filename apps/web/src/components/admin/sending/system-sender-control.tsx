import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { startTransition, useCallback, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitSystemSender } from '@/functions/sending';
import { useT } from '@/i18n/use-t';

/**
 * „Systemmails“ of a sender: says whether it sends them, and the button that makes it the system
 * sender (replacing the one before) or removes the mark.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.senderId The sender.
 * @param props.isSystem Whether it is the system sender.
 * @returns The section.
 */
export function SystemSenderControl({
	announce,
	isSystem,
	senderId,
}: Readonly<{ announce: Announce; senderId: string; isSystem: boolean }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const hydrated = useHydrated();
	const save = useServerFn(submitSystemSender);
	const [isPending, startPending] = useTransition();
	const toggle = useCallback(() => {
		startPending(async () => {
			const result = await settle(save({ data: { senderId: isSystem ? null : senderId } }));
			if (result === undefined) return;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			if (result.ok) {
				announce(t(isSystem ? 'sending.systemClearDone' : 'sending.systemSetDone'), 'status');
			} else {
				announce(
					t(result.failure === 'changed' ? 'sending.changed' : 'sending.senderGone'),
					'alert',
				);
			}
			startTransition(async () => router.invalidate());
		});
	}, [announce, isSystem, router, save, senderId, t]);
	return (
		<section className="flex max-w-xl flex-col gap-3">
			<h2 className="text-xl font-bold">{t('sending.systemHeading')}</h2>
			<p>{t(isSystem ? 'sending.systemOn' : 'sending.systemOff')}</p>
			<Button
				className={`self-start ${secondaryButtonClass}`}
				isPending={!hydrated || isPending}
				onPress={toggle}
			>
				{t(isSystem ? 'sending.systemClear' : 'sending.systemSet')}
			</Button>
		</section>
	);
}
