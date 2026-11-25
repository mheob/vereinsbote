import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { dangerButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitDeleteLayout } from '@/functions/layouts';
import { useT } from '@/i18n/use-t';

/**
 * The button „Löschen“ of a layout and its dialog „{name} löschen?“. A layout that templates use
 * has the button disabled, described by the row's usage; one that was chosen meanwhile is
 * refused by the server, and the page says how many templates use it.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.layout The layout: id, name and the number of templates that use it.
 * @param props.layout.id The layout.
 * @param props.layout.name Its name.
 * @param props.layout.usedBy How many templates use it.
 * @param props.describedBy The id of the text that says how the layout is used.
 * @param props.onChanged Called after the list changed (deleted, gone or found in use).
 * @returns The button with its dialog.
 */
export function DeleteLayoutDialog({
	announce,
	describedBy,
	layout,
	onChanged,
}: Readonly<{
	announce: Announce;
	layout: Readonly<{ id: string; name: string; usedBy: number }>;
	describedBy: string;
	onChanged: () => void;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const remove = useServerFn(submitDeleteLayout);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const { id, name } = layout;
	const confirm = useCallback(() => {
		startPending(async () => {
			const result = await settle(remove({ data: { id } }));
			if (result === undefined) return;
			setIsOpen(false);
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			if (result.ok) {
				announce(t('layouts.deleted', { name }), 'status');
			} else if (result.failure === 'inUse') {
				announce(t('layouts.inUse', { count: result.templates }), 'alert');
			} else {
				announce(t('layouts.gone'), 'alert');
			}
			onChanged();
		});
	}, [announce, id, name, onChanged, remove, t]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			<Button
				aria-describedby={describedBy}
				aria-label={t('layouts.deleteAria', { name })}
				className={dangerButtonClass}
				isDisabled={layout.usedBy > 0}
				isPending={!hydrated}
			>
				{t('layouts.delete')}
			</Button>
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('layouts.deleteTitle', { name })}
						</Heading>
						<p>{t('layouts.deleteText')}</p>
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
								{t('layouts.deleteCancel')}
							</Button>
							<Button className={dangerButtonClass} isPending={isPending} onPress={confirm}>
								{t('layouts.deleteConfirm')}
							</Button>
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}
