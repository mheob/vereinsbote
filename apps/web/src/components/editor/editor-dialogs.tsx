import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { dangerButtonClass, primaryButtonClass, secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';

const overlayClass = 'fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4';
const modalClass = 'w-full max-w-md rounded-md bg-white p-6 shadow-lg';

/**
 * The dialog after a save the server refused because somebody saved the template meanwhile
 * (Design 13): reloading shows their version and discards the own changes, the dialog says so.
 *
 * @param props The props.
 * @param props.isOpen Whether the dialog is open.
 * @param props.onOpenChange Called when it wants to close.
 * @param props.onReload Reloads the page.
 * @returns The dialog.
 */
export function ChangedDialog({
	isOpen,
	onOpenChange,
	onReload,
}: Readonly<{
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onReload: () => void;
}>): ReactNode {
	const t = useT();
	return (
		<ModalOverlay className={overlayClass} isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal className={modalClass}>
				<Dialog className="flex flex-col gap-4 outline-none" role="alertdialog">
					<Heading className="text-xl font-bold" slot="title">
						{t('editor.changedTitle')}
					</Heading>
					<p>{t('editor.changedText')}</p>
					<div className="flex justify-end gap-3">
						<Button className={secondaryButtonClass} slot="close">
							{t('templates.cancel')}
						</Button>
						<Button className={primaryButtonClass} onPress={onReload}>
							{t('editor.reload')}
						</Button>
					</div>
				</Dialog>
			</Modal>
		</ModalOverlay>
	);
}

/**
 * The question before leaving the editor with unsaved changes: stay, or leave and lose them.
 *
 * @param props The props.
 * @param props.isOpen Whether the dialog is open (the router blocked a navigation).
 * @param props.onStay Keeps the page.
 * @param props.onLeave Goes on with the navigation.
 * @returns The dialog.
 */
export function LeaveDialog({
	isOpen,
	onLeave,
	onStay,
}: Readonly<{ isOpen: boolean; onStay: () => void; onLeave: () => void }>): ReactNode {
	const t = useT();
	// Escape keeps the page, like „Weiter bearbeiten“.
	const onOpenChange = useCallback(
		(open: boolean) => {
			if (!open) onStay();
		},
		[onStay],
	);
	return (
		<ModalOverlay className={overlayClass} isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal className={modalClass}>
				<Dialog className="flex flex-col gap-4 outline-none" role="alertdialog">
					<Heading className="text-xl font-bold" slot="title">
						{t('editor.leaveTitle')}
					</Heading>
					<p>{t('editor.leaveText')}</p>
					<div className="flex flex-wrap justify-end gap-3">
						<Button className={secondaryButtonClass} onPress={onStay}>
							{t('editor.leaveStay')}
						</Button>
						<Button className={dangerButtonClass} onPress={onLeave}>
							{t('editor.leaveConfirm')}
						</Button>
					</div>
				</Dialog>
			</Modal>
		</ModalOverlay>
	);
}
