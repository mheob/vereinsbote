import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { dangerButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitDeletePartner } from '@/functions/contacts';
import { useT } from '@/i18n/use-t';

/**
 * The button „Löschen“ of a partner and its dialog „{name} löschen?“. React Aria's modal keeps
 * the focus inside the dialog and returns it to the button when the dialog closes. After the
 * deletion the partner list opens and announces it; the name goes there in the history state,
 * never in the URL.
 *
 * @param props The props.
 * @param props.announce Announces a failure in the page's live region.
 * @param props.contactId The partner.
 * @param props.name The partner's name as the page shows it.
 * @returns The button with its dialog.
 */
export function DeletePartnerDialog({
	announce,
	contactId,
	name,
}: Readonly<{ announce: Announce; contactId: string; name: string }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const hydrated = useHydrated();
	const remove = useServerFn(submitDeletePartner);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const confirm = useCallback(() => {
		startPending(async () => {
			const result = await settle(remove({ data: { contactId } }));
			if (result === undefined) return;
			if (result !== FAILED && result.ok) {
				await router.navigate({
					search: { kind: 'partner' },
					state: { deletedContact: name },
					to: '/contacts',
				});
				return;
			}
			setIsOpen(false);
			announce(t(result === FAILED ? 'auth.requestFailed' : 'contact.gone'), 'alert');
		});
	}, [announce, contactId, name, remove, router, t]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			{/* Pending until hydrated: focusable, but a press does nothing yet. */}
			<Button className={dangerButtonClass} isPending={!hydrated}>
				{t('partner.delete')}
			</Button>
			{/* While the partner is being deleted, the dialog stays until the result is in. */}
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('partner.deleteTitle', { name })}
						</Heading>
						<p>{t('partner.deleteText')}</p>
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
								{t('partner.cancel')}
							</Button>
							<Button className={dangerButtonClass} isPending={isPending} onPress={confirm}>
								{t('partner.deleteConfirm')}
							</Button>
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}
