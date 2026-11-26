import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { FormProps } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { primaryButtonClass, secondaryButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useHydrated } from '@/components/use-hydrated';
import { confirmWave } from '@/functions/waves';
import { useT } from '@/i18n/use-t';
import type { WaveFailure } from '@/server/waves/failures';
import type { RecipientSelection } from '@/server/waves/recipients';
import type { WaveRefusal } from '@/server/waves/waves';

import { defaultSchedule, scheduledInstant } from './schedule';
import type { When } from './schedule';
import { StartFields } from './schedule-field';
import { selectionRequest } from './selection';
import { blockOf, confirmRefusalMessage, flowFailureOf } from './send-messages';
import type { SummaryState } from './summary-state';
import { WaveSummaryView } from './wave-summary';

/** A wave the confirmation made: its mails and when they start (null: at once). */
interface ConfirmedWave {
	readonly mails: number;
	readonly notBefore: Date | null;
}

/** What the confirmation sends besides the start. */
interface ConfirmInput {
	readonly attachmentIds: readonly string[];
	readonly occasionId: string;
	readonly requestId: string;
	readonly selection: RecipientSelection;
}

/**
 * The form inside the dialog: the numbers, „Sofort“ or „Geplant“ with a date and time on the club's
 * clock (Europe/Berlin), and the confirmation. It mounts each time the dialog opens, so the
 * proposed start and its bounds are those of that moment.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.attachments How many files the mail carries.
 * @param props.input The occasion, the selection, the files and the flow's key.
 * @param props.onConfirmed Called with the wave the confirmation made.
 * @param props.onFailure Called with a failure of the flow; the dialog closes then.
 * @param props.summary The numbers of the wave.
 * @returns The form.
 */
function ConfirmForm({
	announce,
	attachments,
	input,
	onConfirmed,
	onFailure,
	summary,
}: Readonly<{
	announce: Announce;
	attachments: number;
	input: ConfirmInput;
	onConfirmed: (wave: ConfirmedWave) => void;
	onFailure: (failure: WaveFailure['failure']) => void;
	summary: SummaryState;
}>): ReactNode {
	const t = useT();
	const confirm = useServerFn(confirmWave);
	const [isPending, startPending] = useTransition();
	const [when, setWhen] = useState<When>('now');
	const [at, setAt] = useState<ReturnType<typeof defaultSchedule> | null>(() =>
		defaultSchedule(new Date()),
	);
	const [refusal, setRefusal] = useState<WaveRefusal | null>(null);
	const blocked = blockOf(summary.status === 'ready' ? summary.summary : null);
	const changeWhen = useCallback((value: When) => {
		setWhen(value);
		setRefusal(null);
	}, []);
	const changeAt = useCallback(
		// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a date of @internationalized/date is an immutable value whose class the rule cannot see into
		(value: ReturnType<typeof defaultSchedule> | null) => {
			setAt(value);
			setRefusal(null);
		},
		[],
	);
	const onSubmit = useCallback<NonNullable<FormProps['onSubmit']>>(
		(event) => {
			event.preventDefault();
			if (when === 'later' && at === null) {
				setRefusal('scheduleOutOfRange');
				return;
			}
			const notBefore = when === 'later' && at !== null ? scheduledInstant(at) : null;
			startPending(async () => {
				const data = {
					...input,
					attachmentIds: [...input.attachmentIds],
					notBefore,
					selection: selectionRequest(input.selection),
				};
				const result = await settle(confirm({ data }));
				if (result === undefined) return;
				if (result === FAILED) {
					announce(t('auth.requestFailed'), 'alert');
				} else if (result.ok) {
					onConfirmed({ mails: result.mails, notBefore });
				} else if (result.failure === 'refused') {
					setRefusal(result.reason);
				} else {
					const failure = flowFailureOf(result);
					if (failure !== null) onFailure(failure);
				}
			});
		},
		[announce, at, confirm, input, onConfirmed, onFailure, t, when],
	);
	const atRefused = refusal === 'scheduleOutOfRange';
	return (
		<PostForm className="flex flex-col gap-4" onSubmit={onSubmit}>
			<p>{t('send.confirmIntro')}</p>
			<WaveSummaryView attachments={attachments} live={false} state={summary} withAttachments />
			<StartFields at={at} isInvalid={atRefused} onAt={changeAt} onWhen={changeWhen} when={when} />
			{refusal === null || atRefused ? null : (
				<p className="font-semibold text-red-700" role="alert">
					{t(confirmRefusalMessage(refusal))}
				</p>
			)}
			{blocked === null ? null : (
				<div className="flex flex-col gap-1 text-red-700">
					<p className="font-semibold">{t('send.confirmBlocked')}</p>
					<p>{t(blocked)}</p>
				</div>
			)}
			<div className="flex flex-wrap justify-end gap-3">
				<Button className={secondaryButtonClass} isDisabled={isPending} slot="close">
					{t('send.cancel')}
				</Button>
				{blocked === null ? (
					<SubmitButton isPending={isPending || summary.status !== 'ready'}>
						{t(when === 'later' ? 'send.confirmLater' : 'send.confirmNow')}
					</SubmitButton>
				) : null}
			</div>
		</PostForm>
	);
}

/**
 * The button „Versand bestätigen …“ and its dialog (Design 10.5): all numbers of the wave, „Sofort“
 * or „Geplant“, and the confirmation, which makes the wave. The flow's key goes with it, so a
 * double click or a retry after a lost answer gets the same wave. Opening the dialog counts the
 * wave anew. React Aria's modal keeps the focus inside and returns it to the button.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.attachments How many files the mail carries.
 * @param props.input The occasion, the selection, the files and the flow's key.
 * @param props.name The name of the occasion.
 * @param props.onConfirmed Called with the wave the confirmation made.
 * @param props.onFailure Called with a failure of the flow.
 * @param props.onOpen Called when the dialog opens.
 * @param props.summary The numbers of the wave.
 * @returns The button with its dialog.
 */
export function ConfirmDialog({
	announce,
	attachments,
	input,
	name,
	onConfirmed,
	onFailure,
	onOpen,
	summary,
}: Readonly<{
	announce: Announce;
	attachments: number;
	input: ConfirmInput;
	name: string;
	onConfirmed: (wave: ConfirmedWave) => void;
	onFailure: (failure: WaveFailure['failure']) => void;
	onOpen: () => void;
	summary: SummaryState;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const [isOpen, setIsOpen] = useState(false);
	const openChange = useCallback(
		(open: boolean) => {
			if (open) onOpen();
			setIsOpen(open);
		},
		[onOpen],
	);
	const fail = useCallback(
		(failure: WaveFailure['failure']) => {
			setIsOpen(false);
			onFailure(failure);
		},
		[onFailure],
	);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={openChange}>
			{/* Pending until hydrated: focusable, but a press does nothing yet. */}
			<Button className={primaryButtonClass} isPending={!hydrated}>
				{t('send.confirmOpen')}
			</Button>
			<ModalOverlay className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
				<Modal className="w-full max-w-xl rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('send.confirmTitle', { name })}
						</Heading>
						<ConfirmForm
							announce={announce}
							attachments={attachments}
							input={input}
							onConfirmed={onConfirmed}
							onFailure={fail}
							summary={summary}
						/>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}

export type { ConfirmedWave, ConfirmInput };
