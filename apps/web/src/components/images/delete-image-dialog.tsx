import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { dangerButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitImageDelete } from '@/functions/images';
import { useT } from '@/i18n/use-t';
import type { LibraryImage, UsingTemplate } from '@/server/media/library';

/**
 * The button „Löschen“ of an image and its dialog „{name} löschen?“. An image a template shows
 * cannot be deleted: the dialog names those templates and offers no deletion; otherwise it warns
 * that the image is also missing from mails already sent. The server decides again, so a
 * template saved meanwhile shows up here as well.
 *
 * @param props The props.
 * @param props.announce Announces the result in the page's live region.
 * @param props.image The image.
 * @param props.onChanged Called after the image is gone, deleted here or elsewhere.
 * @returns The button with its dialog.
 */
export function DeleteImageDialog({
	announce,
	image,
	onChanged,
}: Readonly<{
	announce: Announce;
	image: Readonly<LibraryImage>;
	onChanged: (deletedName: string | null) => void;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const remove = useServerFn(submitImageDelete);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const [lateUsers, setLateUsers] = useState<readonly UsingTemplate[] | null>(null);
	const users = lateUsers ?? image.usedBy;
	const confirm = useCallback(() => {
		startPending(async () => {
			const result = await settle(remove({ data: { id: image.id } }));
			if (result === undefined) return;
			if (result === FAILED) {
				setIsOpen(false);
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			if (result.ok) {
				setIsOpen(false);
				announce(t('images.deleted', { name: image.name }), 'status');
				onChanged(image.name);
				return;
			}
			if (result.failure === 'inUse') {
				// The dialog stays open and now names the templates.
				setLateUsers(result.templates);
				return;
			}
			setIsOpen(false);
			announce(t(result.failure === 'gone' ? 'images.gone' : 'images.storageMissing'), 'alert');
			if (result.failure === 'gone') onChanged(null);
		});
	}, [announce, image.id, image.name, onChanged, remove, t]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			<Button
				aria-label={t('images.deleteAria', { name: image.name })}
				className={dangerButtonClass}
				isPending={!hydrated}
			>
				{t('images.delete')}
			</Button>
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('images.deleteTitle', { name: image.name })}
						</Heading>
						{users.length > 0 ? (
							<>
								<p>{t('images.deleteInUse')}</p>
								<ul className="list-disc pl-6">
									{users.map((template) => (
										<li key={template.id}>{template.name}</li>
									))}
								</ul>
							</>
						) : (
							<p>{t('images.deleteText')}</p>
						)}
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
								{t('images.cancel')}
							</Button>
							{users.length === 0 ? (
								<Button className={dangerButtonClass} isPending={isPending} onPress={confirm}>
									{t('images.deleteConfirm')}
								</Button>
							) : null}
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}
