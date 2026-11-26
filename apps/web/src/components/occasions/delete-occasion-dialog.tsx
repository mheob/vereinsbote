import { Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { dangerButtonClass, linkClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitRemoveOccasion } from '@/functions/occasions';
import { useT } from '@/i18n/use-t';

/** What the dialog tells its page: the occasion is deleted or archived, or it was gone already. */
type RemovedOccasion = 'archived' | 'deleted' | 'gone';

/**
 * The button „Löschen“ of an occasion without waves and its dialog „{name} löschen?“, or
 * „Archivieren“ and „{name} archivieren?“ for one with waves: an occasion with waves is archived,
 * not deleted. Should a wave be made after the page loaded, the occasion is archived and the list
 * says so. Archiving stops no wave: when waves of the occasion are planned or running, the dialog
 * says that they go on and links to the sending overview, where they can be stopped. React Aria's
 * modal keeps the focus inside the dialog and returns it to the button when it closes. An occasion
 * saved since the page loaded it is not removed; the dialog says so and the page loads it anew.
 *
 * @param props The props.
 * @param props.announce Announces a failure in the page's live region.
 * @param props.label The accessible name of the button; the visible one is „Löschen“ or
 *   „Archivieren“.
 * @param props.occasion The occasion: id, name, its waves and the version the page loaded.
 * @param props.occasion.id The occasion.
 * @param props.occasion.name Its name as the page shows it.
 * @param props.occasion.openWaves How many of its waves were planned or running then.
 * @param props.occasion.version The version the page loaded.
 * @param props.occasion.waves How many waves it had when the page loaded it.
 * @param props.onRemoved Called when the occasion is gone or archived.
 * @returns The button with its dialog.
 */
export function DeleteOccasionDialog({
	announce,
	label,
	occasion,
	onRemoved,
}: Readonly<{
	announce: Announce;
	label: string;
	occasion: Readonly<{
		id: string;
		name: string;
		openWaves: number;
		version: number;
		waves: number;
	}>;
	onRemoved: (result: RemovedOccasion) => void;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const remove = useServerFn(submitRemoveOccasion);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const { id, version } = occasion;
	const archives = occasion.waves > 0;
	const confirm = useCallback(() => {
		startPending(async () => {
			const result = await settle(remove({ data: { id, version } }));
			if (result === undefined) return;
			setIsOpen(false);
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
			} else if (result.ok) {
				onRemoved(result.result);
			} else if (result.failure === 'gone') {
				announce(t('occasions.gone'), 'alert');
				onRemoved('gone');
			} else if (result.failure === 'invalid') {
				announce(t('occasions.archivedInvalid'), 'alert');
			} else {
				announce(t('occasions.changed'), 'alert');
			}
		});
	}, [announce, id, onRemoved, remove, t, version]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			{/* Pending until hydrated: focusable, but a press does nothing yet. */}
			<Button aria-label={label} className={dangerButtonClass} isPending={!hydrated}>
				{t(archives ? 'occasions.archive' : 'occasions.delete')}
			</Button>
			{/* While the occasion is being removed, the dialog stays until the result is in. */}
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t(archives ? 'occasions.archiveTitle' : 'occasions.deleteTitle', {
								name: occasion.name,
							})}
						</Heading>
						<p>{t(archives ? 'occasions.archiveText' : 'occasions.deleteText')}</p>
						{archives && occasion.openWaves > 0 ? (
							<p>
								{t('occasions.archiveOpenWaves', { count: occasion.openWaves })}{' '}
								<Link className={linkClass} to="/sending">
									{t('occasions.archiveOpenWavesLink')}
								</Link>
							</p>
						) : null}
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
								{t('occasions.cancel')}
							</Button>
							<Button className={dangerButtonClass} isPending={isPending} onPress={confirm}>
								{t(archives ? 'occasions.archiveConfirm' : 'occasions.deleteConfirm')}
							</Button>
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}

export type { RemovedOccasion };
