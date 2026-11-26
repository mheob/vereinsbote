import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { dangerButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitDeleteTemplate } from '@/functions/templates';
import { useT } from '@/i18n/use-t';

/** What the dialog tells its page: the template is deleted, or it was gone already. */
type RemovedTemplate = 'deleted' | 'gone';

/**
 * The button „Löschen“ of a template and its dialog „{name} löschen?“. React Aria's modal keeps
 * the focus inside the dialog and returns it to the button when it closes. A template saved
 * since the page loaded it is not deleted; the dialog says so and the page loads it anew. A
 * template that occasions use is not deleted either; the message names the occasions.
 *
 * @param props The props.
 * @param props.announce Announces a failure in the page's live region.
 * @param props.label The accessible name of the button; the visible one is „Löschen“.
 * @param props.onRemoved Called when the template is gone, deleted here or before.
 * @param props.template The template: id, name and the version the page loaded.
 * @param props.template.id The template.
 * @param props.template.name Its name as the page shows it.
 * @param props.template.version The version the page loaded.
 * @returns The button with its dialog.
 */
export function DeleteTemplateDialog({
	announce,
	label,
	onRemoved,
	template,
}: Readonly<{
	announce: Announce;
	label: string;
	onRemoved: (result: RemovedTemplate) => void;
	template: Readonly<{ id: string; name: string; version: number }>;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const remove = useServerFn(submitDeleteTemplate);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const { id, version } = template;
	const confirm = useCallback(() => {
		startPending(async () => {
			const result = await settle(remove({ data: { id, version } }));
			if (result === undefined) return;
			setIsOpen(false);
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
			} else if (result.ok) {
				onRemoved('deleted');
			} else if (result.failure === 'gone') {
				announce(t('templates.gone'), 'alert');
				onRemoved('gone');
			} else if (result.failure === 'inUse') {
				announce(t('templates.inUse', { names: result.occasions.join(', ') }), 'alert');
			} else {
				announce(t('templates.changed'), 'alert');
			}
		});
	}, [announce, id, onRemoved, remove, t, version]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			{/* Pending until hydrated: focusable, but a press does nothing yet. */}
			<Button aria-label={label} className={dangerButtonClass} isPending={!hydrated}>
				{t('templates.delete')}
			</Button>
			{/* While the template is being deleted, the dialog stays until the result is in. */}
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('templates.deleteTitle', { name: template.name })}
						</Heading>
						<p>{t('templates.deleteText')}</p>
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
								{t('templates.cancel')}
							</Button>
							<Button className={dangerButtonClass} isPending={isPending} onPress={confirm}>
								{t('templates.deleteConfirm')}
							</Button>
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}

export type { RemovedTemplate };
