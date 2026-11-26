import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { primaryButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { resendUncertain } from '@/functions/waves';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import type { ResendUncertainResult } from '@/server/waves/failures';

/** The text of each refusal of sending an entry again. */
const REFUSAL_KEYS = {
	gone: 'overview.entryGone',
	notUncertain: 'overview.resendNotUncertain',
	stopped: 'overview.resendStopped',
} as const satisfies Readonly<
	Record<Extract<ResendUncertainResult, { ok: false }>['failure'], MessageKey>
>;

/**
 * The button „Erneut senden“ of an uncertain entry and its dialog (Design 8.5): whether the mail
 * arrived is unclear, so a person checks first; sent again, it may arrive twice. Only for users
 * with `send` in the wave's area; the server checks it again. The next run of the outbox takes the
 * entry. The result is announced in the page's live region once the dialog has closed.
 *
 * @param props The props.
 * @param props.announce Announces the result in the page's live region.
 * @param props.email The address the entry's mail went to.
 * @param props.entryId The entry.
 * @param props.onChanged Called after the entry changed or turned out to have changed: the page
 *   loads anew.
 * @returns The button with its dialog.
 */
export function ResendEntryDialog({
	announce,
	email,
	entryId,
	onChanged,
}: Readonly<{
	announce: Announce;
	email: string;
	entryId: string;
	onChanged: () => void;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const resend = useServerFn(resendUncertain);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const confirm = useCallback(() => {
		startPending(async () => {
			const result = await settle(resend({ data: { entryId } }));
			if (result === undefined) return;
			setIsOpen(false);
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			if (result.ok) announce(t('overview.resent', { email }), 'status');
			else announce(t(REFUSAL_KEYS[result.failure]), 'alert');
			onChanged();
		});
	}, [announce, email, entryId, onChanged, resend, t]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			{/* Pending until hydrated: focusable, but a press does nothing yet. */}
			<Button
				aria-label={t('overview.resendAria', { email })}
				className={`whitespace-nowrap ${secondaryButtonClass}`}
				isPending={!hydrated}
			>
				{t('overview.resend')}
			</Button>
			{/* While the entry is being planned again, the dialog stays until the result is in. */}
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('overview.resendTitle', { email })}
						</Heading>
						<p>{t('overview.resendText')}</p>
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
								{t('overview.cancel')}
							</Button>
							<Button className={primaryButtonClass} isPending={isPending} onPress={confirm}>
								{t('overview.resendConfirm')}
							</Button>
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}
