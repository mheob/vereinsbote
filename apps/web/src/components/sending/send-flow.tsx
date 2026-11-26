import { useRouter } from '@tanstack/react-router';
import { startTransition, useCallback, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { primaryButtonClass, secondaryButtonClass } from '@/components/styles';
import { useDebouncedValue } from '@/components/use-debounced-value';
import { useHydrated } from '@/components/use-hydrated';
import type { SendFlowPage } from '@/functions/waves';
import { useT } from '@/i18n/use-t';
import type { WaveFailure } from '@/server/waves/failures';
import type { RecipientChoice } from '@/server/waves/recipient-search';

import { AttachmentStep } from './attachment-step';
import { ConfirmDialog } from './confirm-dialog';
import type { ConfirmedWave } from './confirm-dialog';
import { useFlowAttachments } from './flow-attachments';
import { stepHeading, useSteps } from './flow-steps';
import { PreviewStep } from './preview-step';
import { RecipientStep } from './recipient-step';
import { INITIAL_DRAFT, selectionOf } from './selection';
import type { SelectionDraft } from './selection';
import { waveFailureMessage } from './send-messages';
import { useWaveCount } from './wave-count';

/** How long the count waits after the last change of the selection. */
const COUNT_DELAY_MS = 300;

/**
 * The manual send flow of an occasion (Design 10): recipients, attachments, preview with the test
 * mail, and the confirmation in a dialog. The numbers of the wave are counted by the server as the
 * selection changes. Each step change moves the focus to the step's heading and announces it. The
 * flow's key is made once, when the flow opens: a second confirmation gets the same wave.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.onConfirmed Called with the wave the confirmation made.
 * @param props.page What the page loaded.
 * @returns The flow.
 */
export function SendFlow({
	announce,
	onConfirmed,
	page,
}: Readonly<{
	announce: Announce;
	onConfirmed: (wave: ConfirmedWave) => void;
	page: SendFlowPage;
}>): ReactNode {
	const t = useT();
	const router = useRouter();
	const hydrated = useHydrated();
	const headingId = useId();
	const occasionId = page.occasion.id;
	const { headingRef, move, step } = useSteps(announce);
	const [draft, setDraft] = useState<SelectionDraft>(INITIAL_DRAFT);
	const [picked, setPicked] = useState<Readonly<RecipientChoice> | null>(null);
	const [recount, setRecount] = useState(0);
	// The key of the flow (plan decision 18): made once, in the browser, when the flow opens.
	// oxlint-disable-next-line react/hook-use-state -- kept from the first render, never set
	const [requestId] = useState(() => crypto.randomUUID());
	const { add, attachments, remove } = useFlowAttachments(page.attachments);
	const selection = useMemo(() => selectionOf(draft), [draft]);
	const counted = useDebouncedValue(selection, COUNT_DELAY_MS);
	const attachmentIds = useMemo(() => attachments.map(({ id }) => id), [attachments]);
	const request = useMemo(
		() => ({ attachmentIds, recount, selection: counted }),
		[attachmentIds, counted, recount],
	);
	const onFailure = useCallback(
		(failure: WaveFailure['failure']) => {
			announce(t(waveFailureMessage(failure)), 'alert');
			// The files or the occasion changed: the page loads them anew.
			if (failure === 'attachmentsGone' || failure === 'changed') {
				startTransition(async () => router.invalidate());
			}
		},
		[announce, router, t],
	);
	const summary = useWaveCount(occasionId, request, onFailure);
	const confirmInput = useMemo(
		() => ({ attachmentIds, occasionId, requestId, selection }),
		[attachmentIds, occasionId, requestId, selection],
	);
	const back = useCallback(() => {
		move('back');
	}, [move]);
	const forward = useCallback(() => {
		move('forward');
	}, [move]);
	const countAgain = useCallback(() => {
		setRecount((count) => count + 1);
	}, []);
	const pick = useCallback(
		(contact: Readonly<RecipientChoice>) => {
			setPicked(contact);
			announce(t('send.previewShowing', { name: contact.name }), 'status');
		},
		[announce, t],
	);
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-6">
			<h2 className="text-xl font-bold outline-none" id={headingId} ref={headingRef} tabIndex={-1}>
				{stepHeading(t, step)}
			</h2>
			{step === 'recipients' ? (
				<RecipientStep
					announce={announce}
					draft={draft}
					groups={page.groups}
					occasionId={occasionId}
					onChange={setDraft}
					summary={summary}
					tags={page.tags}
				/>
			) : null}
			{step === 'attachments' ? (
				<AttachmentStep
					announce={announce}
					attachments={attachments}
					graph={page.sender.provider === 'graph'}
					occasionId={occasionId}
					onAdded={add}
					onRemoved={remove}
					summary={summary}
				/>
			) : null}
			{step === 'preview' ? (
				<PreviewStep
					announce={announce}
					attachmentIds={attachmentIds}
					onFailure={onFailure}
					onPick={pick}
					page={page}
					picked={picked}
					selection={selection}
				/>
			) : null}
			<div className="flex flex-wrap gap-3">
				{step === 'recipients' ? null : (
					<Button className={secondaryButtonClass} isPending={!hydrated} onPress={back}>
						{t('send.previous')}
					</Button>
				)}
				{step === 'preview' ? (
					<ConfirmDialog
						announce={announce}
						attachments={attachments.length}
						input={confirmInput}
						name={page.occasion.name}
						onConfirmed={onConfirmed}
						onFailure={onFailure}
						onOpen={countAgain}
						summary={summary}
					/>
				) : (
					<Button className={primaryButtonClass} isPending={!hydrated} onPress={forward}>
						{t('send.next')}
					</Button>
				)}
			</div>
		</section>
	);
}
