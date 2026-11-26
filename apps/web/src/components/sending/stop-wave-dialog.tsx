import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { dangerButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { stopWave } from '@/functions/waves';
import { useT } from '@/i18n/use-t';

/**
 * The button „Welle stoppen“ and its dialog „Welle „{Anlass}“ stoppen?“ (Design 11.4): the planned
 * mails of the wave are cancelled, mails on their way still go out. Only for users with `send` in
 * the wave's area; the server checks it again. The result is announced in the page's live region
 * once the dialog has closed; React Aria's modal keeps the focus inside the dialog while it is
 * open.
 *
 * @param props The props.
 * @param props.announce Announces the result in the page's live region.
 * @param props.onStopped Called after the stop, or when the wave is gone: the page loads anew.
 * @param props.wave The wave: its id and the name of its occasion.
 * @param props.wave.id The wave.
 * @param props.wave.occasionName The name of its occasion.
 * @returns The button with its dialog.
 */
export function StopWaveDialog({
	announce,
	onStopped,
	wave,
}: Readonly<{
	announce: Announce;
	onStopped: () => void;
	wave: Readonly<{ id: string; occasionName: string }>;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const stop = useServerFn(stopWave);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const confirm = useCallback(() => {
		startPending(async () => {
			const result = await settle(stop({ data: { waveId: wave.id } }));
			if (result === undefined) return;
			setIsOpen(false);
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			if (result.ok) {
				const { cancelled } = result;
				announce(
					cancelled === 1 ? t('overview.stoppedOne') : t('overview.stopped', { count: cancelled }),
					'status',
				);
			} else {
				announce(t('overview.waveGone'), 'alert');
			}
			onStopped();
		});
	}, [announce, onStopped, stop, t, wave.id]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			{/* Pending until hydrated: focusable, but a press does nothing yet. */}
			<Button className={`self-start ${dangerButtonClass}`} isPending={!hydrated}>
				{t('overview.stop')}
			</Button>
			{/* While the wave is being stopped, the dialog stays until the result is in. */}
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('overview.stopTitle', { occasion: wave.occasionName })}
						</Heading>
						<p>{t('overview.stopText')}</p>
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
								{t('overview.cancel')}
							</Button>
							<Button className={dangerButtonClass} isPending={isPending} onPress={confirm}>
								{t('overview.stopConfirm')}
							</Button>
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}
