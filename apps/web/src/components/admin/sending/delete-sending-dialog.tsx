import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { dangerButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitDeleteConnection, submitDeleteSender } from '@/functions/sending';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import type { SendingFailure } from '@/server/sending/failures';

/** What is deleted: a connection or a sender. */
type DeletedKind = 'connection' | 'sender';

/**
 * The text that tells why a delete was refused.
 *
 * @param failure The refusal.
 * @returns The key and the parameters of the message.
 */
function refusal(failure: SendingFailure): { key: MessageKey; params: Record<string, number> } {
	if (failure.failure === 'connectionInUse') {
		const { senders } = failure;
		return {
			key: senders === 1 ? 'sending.connectionInUseOne' : 'sending.connectionInUse',
			params: { count: senders },
		};
	}
	if (failure.failure === 'senderInUse') {
		return {
			key:
				failure.reason === 'entries'
					? 'sending.senderInUseEntries'
					: 'sending.senderInUseOccasions',
			params: {},
		};
	}
	return { key: 'sending.senderGone', params: {} };
}

/**
 * The button „Löschen“ of a connection or a sender and its dialog „{name} löschen?“. A refused
 * delete (in use, already gone) is announced and the page loads anew.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.kind What is deleted.
 * @param props.id The connection or sender.
 * @param props.name Its name (a connection's name, a sender's address).
 * @param props.isDisabled Whether the button is disabled (a connection with senders).
 * @param props.isSystem Whether the sender sends the system mails: the dialog says what stops.
 * @param props.describedBy The id of the text that says why it is disabled.
 * @param props.onDeleted Called after it was deleted or found gone.
 * @param props.onRefused Called after a refusal, so the page loads anew.
 * @returns The button with its dialog.
 */
export function DeleteSendingDialog({
	announce,
	describedBy,
	id,
	isDisabled,
	isSystem = false,
	kind,
	name,
	onDeleted,
	onRefused,
}: Readonly<{
	announce: Announce;
	kind: DeletedKind;
	id: string;
	name: string;
	isDisabled: boolean;
	isSystem?: boolean;
	describedBy?: string;
	onDeleted: () => void;
	onRefused: () => void;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const removeConnection = useServerFn(submitDeleteConnection);
	const removeSender = useServerFn(submitDeleteSender);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const confirm = useCallback(() => {
		startPending(async () => {
			const result = await settle(
				kind === 'connection' ? removeConnection({ data: { id } }) : removeSender({ data: { id } }),
			);
			if (result === undefined) return;
			setIsOpen(false);
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			if (result.ok) {
				onDeleted();
				return;
			}
			const { key, params } = refusal(result);
			announce(t(key, params), 'alert');
			onRefused();
		});
	}, [announce, id, kind, onDeleted, onRefused, removeConnection, removeSender, t]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			<Button
				aria-describedby={describedBy}
				aria-label={t('sending.deleteAria', { name })}
				className={dangerButtonClass}
				isDisabled={isDisabled}
				isPending={!hydrated}
			>
				{t('sending.delete')}
			</Button>
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t(
								kind === 'connection'
									? 'sending.deleteConnectionTitle'
									: 'sending.deleteSenderTitle',
								{
									name,
								},
							)}
						</Heading>
						<p>
							{t(
								kind === 'connection' ? 'sending.deleteConnectionText' : 'sending.deleteSenderText',
							)}
						</p>
						{isSystem ? <p>{t('sending.deleteSystemSenderText')}</p> : null}
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
								{t('sending.deleteCancel')}
							</Button>
							<Button className={dangerButtonClass} isPending={isPending} onPress={confirm}>
								{t('sending.deleteConfirm')}
							</Button>
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}
